import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from '../stripe';
import { sendEmail } from '@/lib/email/brevo';
import { renderAdminPaymentReceivedEmail } from '@/lib/email/templates/admin-payment-received';
import { renderPaymentReceiptEmail } from '@/lib/email/templates/payment-receipt';
import { publicEnv } from '@/lib/env';
import { formatPrice } from '@/lib/listings/format';
import {
  findSubscriptionRowId,
  invoiceSubscriptionId,
  paymentIntentIdFromInvoice,
  updateSubscriptionFromStripe,
} from './_helpers';

/**
 * Handler for `invoice.paid`.
 *
 * Per `docs/DECISIONS.md` "invoice.paid for fulfillment; invoice.payment_succeeded
 * explicitly NOT handled" — we use `invoice.paid` because it fires after the
 * invoice is fully reconciled. `invoice.payment_succeeded` is silently
 * ignored at the dispatcher.
 *
 * Steps:
 *   1. Fresh-fetch the invoice (consistent with the fresh-fetch pattern).
 *   2. If the invoice isn't tied to a subscription, ignore (one-off invoices).
 *   3. Fresh-fetch the subscription and update our row — `current_period_end`
 *      now extends by one billing period.
 *   4. Record the payment row, idempotent on `stripe_payment_intent_id`.
 *
 * Order matters: we update the subscription state BEFORE inserting the
 * payment, so the payment's `subscription_id` FK is guaranteed to exist
 * even on a redelivered event for a brand-new subscription.
 */
export async function handleInvoicePaid(event: Stripe.Event): Promise<void> {
  const invoiceFromEvent = event.data.object as Stripe.Invoice;
  if (!invoiceFromEvent.id) {
    throw new Error('invoice.paid event has no invoice id');
  }

  const stripe = getStripeClient();
  const invoice = await stripe.invoices.retrieve(invoiceFromEvent.id);

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.log('[invoice.paid] non-subscription invoice ignored', invoice.id);
    return;
  }

  // Refresh subscription state — period_end now extends.
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await updateSubscriptionFromStripe(sub);

  // Now look up the row UUID to attach the payment.
  const subRowId = await findSubscriptionRowId(subscriptionId);

  // Record the payment. Idempotent via the unique constraint on
  // stripe_payment_intent_id; on conflict we leave the existing row alone.
  const supabase = createAdminClient();
  const paymentIntentId = paymentIntentIdFromInvoice(invoice);

  const upsertResult = await supabase
    .from('payments')
    .upsert(
      {
        subscription_id: subRowId,
        stripe_payment_intent_id: paymentIntentId,
        stripe_invoice_id: invoice.id,
        amount_cents: invoice.amount_paid,
        currency: invoice.currency.toUpperCase(),
        status: 'succeeded',
      },
      { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true },
    )
    .select('id');
  if (upsertResult.error) {
    console.error('[billing/invoice-paid] payments upsert failed', {
      code: upsertResult.error.code,
      message: upsertResult.error.message,
      details: upsertResult.error.details,
      hint: upsertResult.error.hint,
    });
  }

  // Admin notification — fire only on fresh inserts. With
  // `ignoreDuplicates: true`, a duplicate returns an empty rows array
  // from .select(). The dedup table at the route layer also covers
  // redelivered Stripe events, but defense-in-depth: this avoids a
  // double-notification if the route's dedup ever misses.
  const wasFreshInsert = (upsertResult.data?.length ?? 0) > 0;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail && wasFreshInsert) {
    try {
      // Resolve org name + plan id from our subscription row.
      let orgName: string | null = null;
      let planId: string | null = null;
      if (subRowId) {
        const { data: subRow } = await supabase
          .from('subscriptions')
          .select(
            'plan_id, organizations!subscriptions_org_id_fkey(name)',
          )
          .eq('id', subRowId)
          .maybeSingle();
        if (subRow) {
          planId = (subRow.plan_id as string | null) ?? null;
          const orgJoin = subRow.organizations as
            | { name?: string | null }
            | { name?: string | null }[]
            | null;
          const org = Array.isArray(orgJoin) ? orgJoin[0] : orgJoin;
          orgName = org?.name ?? null;
        }
      }

      const customerEmail =
        (invoice.customer_email as string | null) ??
        ((invoice.customer as { email?: string | null } | null)?.email ?? '—');
      const amountLabel = formatPrice(
        invoice.amount_paid ?? 0,
        invoice.currency.toUpperCase(),
        'en',
      );
      const dashboardUrl = `https://dashboard.stripe.com/invoices/${invoice.id}`;
      const email = renderAdminPaymentReceivedEmail({
        amountLabel,
        invoiceId: invoice.id,
        customerEmail,
        orgName,
        planId,
        dashboardUrl,
      });
      const sendResult = await sendEmail({
        to: adminEmail,
        subject: email.subject,
        html: email.html,
      });
      if (!sendResult.sent) {
        console.warn('[invoice.paid] admin notification not sent', sendResult.error);
      }
    } catch (e) {
      console.error('[invoice.paid] admin notification threw', e);
    }
  }

  // ----- Customer-facing receipt (always, on every successful invoice) -----
  // Separate try/catch so admin notification + customer receipt are
  // independent failure domains. Either can fail without blocking the
  // other or the webhook ack.
  if (wasFreshInsert) {
    try {
      const customerEmail =
        (invoice.customer_email as string | null) ??
        ((invoice.customer as { email?: string | null } | null)?.email ?? null);
      if (!customerEmail) {
        console.warn('[invoice.paid] no customer email on invoice; skip receipt');
      } else {
        const customerName =
          (invoice.customer_name as string | null) ??
          ((invoice.customer as { name?: string | null } | null)?.name ?? null);
        const amountLabel = formatPrice(
          invoice.amount_paid ?? 0,
          invoice.currency.toUpperCase(),
          'en',
        );
        // Resolve plan label + isOnMonthly from the subscription's plan_id.
        // Subscription fresh-fetched above; we just need the price metadata.
        const priceItem = sub.items.data[0];
        const recurring = priceItem?.price?.recurring;
        const isOnMonthly = recurring?.interval === 'month';
        const planLabel = resolvePlanLabel(sub);

        // Next renewal — sub.current_period_end is a unix timestamp.
        const nextRenewalDate = new Date(
          (sub.current_period_end ?? Date.now() / 1000) * 1000,
        ).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });

        // Welcome window — 3 days from the FIRST paid invoice on this
        // subscription. We approximate with `sub.created` (creation time)
        // since the first invoice's `created` matches sub.created
        // closely enough for the cutoff.
        const createdMs = (sub.created ?? Date.now() / 1000) * 1000;
        const inWelcomeWindow = Date.now() - createdMs < 3 * 24 * 60 * 60 * 1000;

        const { NEXT_PUBLIC_SITE_URL } = publicEnv();
        // Upgrade URL — points at the billing portal's "switch plan"
        // surface with a query hint that the API can use to apply the
        // WELCOME5 coupon when the user is still in-window. The coupon
        // itself is a server-side guard, not a client-trustable hint;
        // see /api/billing/checkout-session for the verification logic.
        const upgradeUrl = `${NEXT_PUBLIC_SITE_URL}/en/dashboard/billing?upgrade=annual${
          inWelcomeWindow ? '&welcome=1' : ''
        }`;
        const billingPortalUrl = `${NEXT_PUBLIC_SITE_URL}/en/dashboard/billing`;
        const hostedInvoiceUrl =
          (invoice.hosted_invoice_url as string | null) ?? null;

        const email = renderPaymentReceiptEmail({
          customerName,
          amountLabel,
          planLabel,
          nextRenewalDate,
          hostedInvoiceUrl,
          billingPortalUrl,
          isOnMonthly,
          upgradeUrl,
          inWelcomeWindow,
        });
        const sendResult = await sendEmail({
          to: customerEmail,
          subject: email.subject,
          html: email.html,
        });
        if (!sendResult.sent) {
          console.warn(
            '[invoice.paid] customer receipt not sent',
            sendResult.error,
          );
        }
      }
    } catch (e) {
      console.error('[invoice.paid] customer receipt threw', e);
    }
  }
}

/**
 * Resolve a human-friendly plan label from a Stripe subscription. Order:
 *   1. price.nickname (set in dashboard when we created the product)
 *   2. product.name from the expanded item (if loaded)
 *   3. Fallback to interval-based label
 *
 * Keeps the receipt readable even when Stripe metadata is incomplete.
 */
function resolvePlanLabel(sub: Stripe.Subscription): string {
  const item = sub.items.data[0];
  if (!item) return 'AHO subscription';
  const price = item.price;
  if (price.nickname) return price.nickname;
  const product = price.product;
  if (typeof product === 'object' && product != null && 'name' in product) {
    const name = (product as { name?: string }).name;
    if (name) return name;
  }
  const interval = price.recurring?.interval;
  return interval === 'year' ? 'AHO annual subscription' : 'AHO monthly subscription';
}

