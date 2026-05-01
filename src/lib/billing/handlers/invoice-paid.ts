import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from '../stripe';
import { sendEmail } from '@/lib/email/brevo';
import { renderAdminPaymentReceivedEmail } from '@/lib/email/templates/admin-payment-received';
import { formatPrice } from '@/lib/listings/format';
import {
  findSubscriptionRowId,
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
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // Stripe API has moved subscription linkage between Invoice-level and
  // line-item-level across versions. Try both.
  const inv = invoice as unknown as { subscription?: string | { id: string } | null };
  if (typeof inv.subscription === 'string') return inv.subscription;
  if (inv.subscription && typeof inv.subscription === 'object') return inv.subscription.id;

  // Newer API: subscription is on the line item's parent.
  const firstLine = invoice.lines?.data?.[0] as
    | { parent?: { subscription_item_details?: { subscription?: string } } }
    | undefined;
  return firstLine?.parent?.subscription_item_details?.subscription ?? null;
}

function paymentIntentIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as { payment_intent?: string | { id: string } | null };
  if (typeof inv.payment_intent === 'string') return inv.payment_intent;
  if (inv.payment_intent && typeof inv.payment_intent === 'object') {
    return inv.payment_intent.id;
  }
  return null;
}
