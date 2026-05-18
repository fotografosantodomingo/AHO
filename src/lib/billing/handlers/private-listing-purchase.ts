import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Handler for `checkout.session.completed` events with
 *   mode === 'payment'
 *   metadata.aho_purpose === 'private_listing'
 *
 * Inserts a `listing_purchases` row representing the $5 charge.
 *
 * Idempotency:
 *   1. Route-level dedup via `stripe_events_processed` already short-
 *      circuits Stripe redeliveries before this runs.
 *   2. Defense-in-depth: `stripe_session_id` is UNIQUE — a duplicate
 *      insert is caught here as PG error 23505 and treated as success
 *      (the row exists, we did our job on the first delivery).
 *
 * Renewal case: when `metadata.renewal_property_id` is a non-empty
 * uuid, the new purchase row is linked to that property AND the
 * property's expires_at is bumped to paid_at + 60 days, with status
 * flipped from 'expired' back to 'active' if applicable.
 *
 * Per docs/SELL_FUNNEL_PLAN.md Track D §3.
 */
export async function handlePrivateListingPurchase(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  const buyerUserId = session.metadata?.buyer_user_id;
  if (!buyerUserId) {
    throw new Error(
      `Private-listing checkout session ${session.id} missing metadata.buyer_user_id; cannot bind to user.`,
    );
  }

  const renewalPropertyIdRaw = session.metadata?.renewal_property_id ?? '';
  const renewalPropertyId =
    renewalPropertyIdRaw === '' ? null : renewalPropertyIdRaw;

  // Resolve PaymentIntent id (the charge.refunded handler keys off this).
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  // Stripe sends `amount_total` (post-tax) and `currency` (3-letter ISO)
  // on completed sessions. Both should always be set for our flow; fail
  // loudly if not, since the row's CHECK + NOT NULL constraints would
  // reject the insert anyway and we want a clearer error.
  const amountTotal = session.amount_total;
  if (typeof amountTotal !== 'number' || amountTotal <= 0) {
    throw new Error(
      `Private-listing session ${session.id} missing amount_total (got ${amountTotal}).`,
    );
  }
  const currency = session.currency;
  if (!currency) {
    throw new Error(`Private-listing session ${session.id} missing currency.`);
  }

  const paidAtMs = session.created * 1000;
  const paidAt = new Date(paidAtMs).toISOString();
  const expiresAt = new Date(paidAtMs + SIXTY_DAYS_MS).toISOString();

  const supabase = createAdminClient();
  const { error: insertErr } = await supabase
    .from('listing_purchases')
    .insert({
      buyer_user_id: buyerUserId,
      property_id: renewalPropertyId,
      stripe_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      stripe_event_id: event.id,
      amount_cents: amountTotal,
      currency: currency.toUpperCase(),
      paid_at: paidAt,
      expires_at: expiresAt,
    });

  if (insertErr) {
    // 23505 — unique violation on stripe_session_id. This is a retry
    // for an already-processed payment. Treat as success.
    if (insertErr.code === '23505') {
      console.warn(
        '[private-listing] duplicate session insert ignored',
        session.id,
      );
    } else {
      // Any other error is a real failure — throw so the route layer
      // rolls back the dedup row and Stripe retries.
      console.error('[private-listing] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
        details: insertErr.details,
        hint: insertErr.hint,
      });
      throw insertErr;
    }
  }

  // Renewal: extend the linked property's lifetime.
  if (renewalPropertyId) {
    const { data: property, error: lookupErr } = await supabase
      .from('properties')
      .select('id, status')
      .eq('id', renewalPropertyId)
      .maybeSingle();
    if (lookupErr) {
      console.error(
        '[private-listing] renewal property lookup failed',
        lookupErr,
      );
      throw lookupErr;
    }
    if (!property) {
      // The user paid to renew a property that no longer exists. The
      // purchase row sits with paid_at set and no linked property,
      // which the day-55 cron's "finish your listing" branch picks up.
      console.warn(
        '[private-listing] renewal target property not found',
        renewalPropertyId,
      );
      return;
    }

    const update: Record<string, unknown> = { expires_at: expiresAt };
    if (property.status === 'expired') {
      update.status = 'active';
    }
    const { error: updErr } = await supabase
      .from('properties')
      .update(update)
      .eq('id', renewalPropertyId);
    if (updErr) {
      console.error('[private-listing] renewal property update failed', updErr);
      throw updErr;
    }
  }
}

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;
