import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Handler for `charge.refunded`.
 *
 * Updates the matching `payments` row's status:
 *   - `refunded` if the full charge amount has been refunded
 *   - `partially_refunded` otherwise
 *
 * Entitlement implications (e.g., should the subscription be cancelled?)
 * are NOT computed here — Stripe fires `customer.subscription.updated`
 * separately when the cancellation logic kicks in, and our regular handler
 * picks that up. Refund without subscription change is the normal
 * "credit-and-keep" path; refund with subscription change is two events.
 *
 * Idempotent on re-delivery — repeated UPDATE on the same row is a no-op.
 */
export async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;

  const piId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!piId) {
    console.log('[charge.refunded] no payment_intent on charge; ignored', charge.id);
    return;
  }

  const supabase = createAdminClient();
  const { data: payment, error: lookupErr } = await supabase
    .from('payments')
    .select('id, amount_cents')
    .eq('stripe_payment_intent_id', piId)
    .maybeSingle();
  if (lookupErr) {
    console.error('[charge.refunded] payment lookup failed', lookupErr);
    return;
  }
  if (!payment) {
    console.warn('[charge.refunded] no payments row for PI', piId);
    return;
  }

  const refundedTotal = charge.amount_refunded ?? 0;
  const totalAmount = Number(payment.amount_cents);
  const fullyRefunded = refundedTotal >= totalAmount;

  const { error: updErr } = await supabase
    .from('payments')
    .update({
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
    })
    .eq('id', payment.id);
  if (updErr) {
    console.error('[charge.refunded] payments update failed', updErr);
  }
}
