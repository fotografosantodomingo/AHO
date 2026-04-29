import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from '../stripe';
import {
  findSubscriptionRowId,
  updateSubscriptionFromStripe,
} from './_helpers';

/**
 * Handler for `invoice.payment_failed`.
 *
 * Steps:
 *   1. Fresh-fetch the invoice.
 *   2. If not tied to a subscription, ignore.
 *   3. Fresh-fetch the subscription — Stripe will have flipped `status` to
 *      `past_due` (Stripe handles dunning retries internally; we just
 *      reflect what they tell us).
 *   4. Record the failed payment.
 *   5. (Future) Kick off our T+0 dunning email via Resend. Out of scope this
 *      turn; the dunning policy is in HANDOFF §7.5.
 *
 * The dunning policy progressively restricts access at T+5 (listings
 * hidden, contact reveal disabled) and downgrades at T+7. That logic
 * doesn't live here — it runs from a daily cron checking `current_status =
 * 'past_due'` rows, which is enabled by the entitlement denorm trigger
 * we added in 0007.
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoiceFromEvent = event.data.object as Stripe.Invoice;
  if (!invoiceFromEvent.id) {
    throw new Error('invoice.payment_failed event has no invoice id');
  }

  const stripe = getStripeClient();
  const invoice = await stripe.invoices.retrieve(invoiceFromEvent.id);

  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) {
    console.log('[invoice.payment_failed] non-subscription invoice ignored', invoice.id);
    return;
  }

  // Refresh subscription state. Stripe should now show status='past_due'.
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  await updateSubscriptionFromStripe(sub);

  const subRowId = await findSubscriptionRowId(subscriptionId);
  const supabase = createAdminClient();
  const paymentIntentId = paymentIntentIdFromInvoice(invoice);

  await supabase.from('payments').upsert(
    {
      subscription_id: subRowId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_due,
      currency: invoice.currency.toUpperCase(),
      status: 'failed',
      failure_reason:
        invoice.last_finalization_error?.message ??
        invoice.last_finalization_error?.code ??
        'payment_failed',
    },
    { onConflict: 'stripe_payment_intent_id', ignoreDuplicates: true },
  );
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as { subscription?: string | { id: string } | null };
  if (typeof inv.subscription === 'string') return inv.subscription;
  if (inv.subscription && typeof inv.subscription === 'object') return inv.subscription.id;
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
