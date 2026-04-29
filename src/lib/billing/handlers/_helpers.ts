import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Helpers shared across webhook handlers.
 *
 * The fresh-fetch principle (per `docs/DECISIONS.md` "customer.subscription.
 * updated handler: fresh-fetch from Stripe") means callers always pass the
 * authoritative Stripe.Subscription object retrieved via `stripe.subscriptions
 * .retrieve(id)` — never the event payload's `data.object` blindly.
 */

/**
 * Extract the current billing period from a Stripe Subscription.
 *
 * Stripe API has moved these fields between Subscription-level and
 * SubscriptionItem-level across versions. We prefer item-level (newer) and
 * fall back to subscription-level (older) so the code works across
 * SDK / API combinations.
 */
function periodFromSubscription(sub: Stripe.Subscription): {
  start: number;
  end: number;
} {
  const item = sub.items.data[0] as { current_period_start?: number; current_period_end?: number } | undefined;
  const subAny = sub as unknown as { current_period_start?: number; current_period_end?: number };
  const start = item?.current_period_start ?? subAny.current_period_start;
  const end = item?.current_period_end ?? subAny.current_period_end;
  if (typeof start !== 'number' || typeof end !== 'number') {
    throw new Error(
      `Could not extract billing period from subscription ${sub.id} — expected current_period_start/end on subscription or its first item.`,
    );
  }
  return { start, end };
}

export interface UpsertResult {
  /** The org_id of the matching subscription row, or null if none existed. */
  orgId: string | null;
  /** Internal plan_id (e.g., `aho_agent_monthly`) resolved from the Stripe price. */
  planId: string;
}

/**
 * Update an existing `subscriptions` row from a Stripe Subscription. Does
 * NOT create rows — `checkout.session.completed` is the only event that
 * creates them. If no matching row exists, returns `{ orgId: null }` and
 * the caller decides whether to skip or fail.
 *
 * Fields written: plan_id, stripe_customer_id, status, current_period_start,
 * current_period_end, cancel_at_period_end, trial_end. user_id and org_id
 * are NOT touched (existing row owns them).
 */
export async function updateSubscriptionFromStripe(
  stripeSub: Stripe.Subscription,
): Promise<UpsertResult> {
  const supabase = createAdminClient();

  const stripePriceId = stripeSub.items.data[0]?.price.id;
  if (!stripePriceId) {
    throw new Error(`Subscription ${stripeSub.id} has no items / no price.`);
  }

  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id')
    .eq('stripe_price_id', stripePriceId)
    .maybeSingle();
  if (planErr) throw planErr;
  if (!plan) {
    throw new Error(
      `No plan row matches Stripe price ${stripePriceId}; run pnpm db:seed.`,
    );
  }

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, org_id')
    .eq('stripe_subscription_id', stripeSub.id)
    .maybeSingle();

  if (!existing) {
    return { orgId: null, planId: plan.id as string };
  }

  const { start, end } = periodFromSubscription(stripeSub);
  const stripeCustomerId =
    typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id;

  const { error } = await supabase
    .from('subscriptions')
    .update({
      plan_id: plan.id,
      stripe_customer_id: stripeCustomerId,
      status: stripeSub.status,
      current_period_start: new Date(start * 1000).toISOString(),
      current_period_end: new Date(end * 1000).toISOString(),
      cancel_at_period_end: stripeSub.cancel_at_period_end,
      trial_end: stripeSub.trial_end
        ? new Date(stripeSub.trial_end * 1000).toISOString()
        : null,
    })
    .eq('id', existing.id);
  if (error) throw error;

  return { orgId: existing.org_id as string, planId: plan.id as string };
}

/** Look up our subscription row's UUID by Stripe's subscription ID. */
export async function findSubscriptionRowId(
  stripeSubscriptionId: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();
  return data?.id ?? null;
}
