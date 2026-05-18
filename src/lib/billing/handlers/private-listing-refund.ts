import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Handler for `charge.refunded` for the $5 private-listing product.
 *
 * Dispatch is via PaymentIntent id (charges carry PI, NOT session id),
 * which the purchase-creation handler stamped onto
 * `listing_purchases.stripe_payment_intent_id` at session-completion
 * time. If no purchase row matches, this handler is a no-op (the refund
 * is for some other product — the existing `handleChargeRefunded` for
 * subscriptions runs in parallel).
 *
 * Idempotent:
 *   - Route-level dedup via `stripe_events_processed` short-circuits
 *     Stripe redeliveries.
 *   - UPDATE on the same row twice is a no-op (refunded_at stays
 *     pinned to its first value via COALESCE-style logic — we only
 *     update when null).
 *
 * Side effects:
 *   1. Stamp `refunded_at = now()` on the matching purchase row.
 *   2. If the purchase is linked to an active property published via
 *      private_purchase, flip the property to status='archived'. We do
 *      NOT archive properties published via agent_subscription — that
 *      path is owned by the subscription-flow handler.
 */
export async function handlePrivateListingRefund(
  event: Stripe.Event,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge;

  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) {
    // No PI to dispatch on — the subscription-flow refund handler
    // logs the same case. Just bail.
    return;
  }

  const supabase = createAdminClient();
  const { data: purchase, error: lookupErr } = await supabase
    .from('listing_purchases')
    .select('id, property_id, refunded_at')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  if (lookupErr) {
    console.error('[private-listing refund] lookup failed', lookupErr);
    throw lookupErr;
  }
  if (!purchase) {
    // Not a private listing — leave for the subscription `payments`
    // handler. This is the normal case; ~all refunds will not match.
    return;
  }

  if (purchase.refunded_at) {
    // Already processed (e.g., redelivery slipped past dedup table).
    return;
  }

  const refundedAt = new Date(event.created * 1000).toISOString();
  const { error: updErr } = await supabase
    .from('listing_purchases')
    .update({ refunded_at: refundedAt })
    .eq('id', purchase.id)
    .is('refunded_at', null);
  if (updErr) {
    console.error('[private-listing refund] purchase update failed', updErr);
    throw updErr;
  }

  // Archive the linked property if it was published via this purchase.
  if (purchase.property_id) {
    const { data: property, error: propErr } = await supabase
      .from('properties')
      .select('id, status, published_via')
      .eq('id', purchase.property_id)
      .maybeSingle();
    if (propErr) {
      console.error('[private-listing refund] property lookup failed', propErr);
      throw propErr;
    }
    if (
      property &&
      property.status === 'active' &&
      property.published_via === 'private_purchase'
    ) {
      const { error: archErr } = await supabase
        .from('properties')
        .update({ status: 'archived' })
        .eq('id', property.id);
      if (archErr) {
        console.error(
          '[private-listing refund] property archive failed',
          archErr,
        );
        throw archErr;
      }
    }
  }
}
