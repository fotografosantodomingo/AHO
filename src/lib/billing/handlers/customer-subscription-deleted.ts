import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Handler for `customer.subscription.deleted` — Stripe has fully deleted
 * the subscription (final-state cancellation, end-of-period cancellation
 * fired through, or admin-initiated cancellation).
 *
 * What we do:
 *   1. Mark our subscription row's `status='canceled'`. The trigger from
 *      0007 propagates `current_status` to `organizations` automatically.
 *   2. If the subscription was canceled before any successful billing AND
 *      had a founder-rate grant, release the slot back to the pool.
 *
 * The "successful billing" check uses our `payments` table, not Stripe —
 * we record `status='succeeded'` rows from `invoice.paid` events. If no
 * such row exists, no billing cycle ever cleared, so the founder rate
 * slot was never "spent" and can be returned to the pool. (Per
 * `docs/DECISIONS.md` "Founder-rate pricing is application-gated":
 * pre-billing cancellations release; post-billing cancellations don't.)
 */
export async function handleCustomerSubscriptionDeleted(
  event: Stripe.Event,
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  if (!sub.id) {
    throw new Error('subscription.deleted event has no subscription id');
  }

  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, status')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle();

  if (!existing) {
    console.warn(
      `[customer.subscription.deleted] no DB row for ${sub.id}; skipped`,
    );
    return;
  }

  // Status flip. The `subscriptions` AFTER UPDATE trigger from 0007
  // recomputes `organizations.current_status` automatically.
  const { error: updErr } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      cancel_at_period_end: false,
    })
    .eq('id', existing.id);
  if (updErr) throw updErr;

  // If this was canceled before any successful billing, release the founder slot.
  // Idempotent: `release_founder_rate_slot` returns false (no-op) if no
  // active grant exists.
  const { count } = await supabase
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_id', existing.id)
    .eq('status', 'succeeded');

  if ((count ?? 0) === 0) {
    const { error: releaseErr } = await supabase.rpc('release_founder_rate_slot', {
      p_subscription_id: existing.id,
    });
    if (releaseErr) {
      console.error(
        `[customer.subscription.deleted] failed to release founder slot for ${existing.id}`,
        releaseErr,
      );
      // Don't rethrow — releasing is hygiene; the cancellation itself succeeded.
    }
  }
}
