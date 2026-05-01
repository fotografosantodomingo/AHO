import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from '../stripe';
import { slugifyOrgName } from '../slug';
import { isFounderEligible } from '../founder-rate';

/**
 * Handler for `checkout.session.completed` — the agent has just paid for the
 * first time. We materialize the org + subscription + organization_members
 * (owner) atomically.
 *
 * Idempotency: the `markEventProcessed` dedup in the route layer handles
 * "Stripe redelivered this event." But we also want this handler itself to
 * be safe to re-run (e.g., a partial earlier run failed mid-way and Stripe
 * retried). All inserts use `on_conflict do nothing` / upsert semantics.
 *
 * Failures: any throw rolls back the entire side-effect set via the
 * transaction; the dedup row is also rolled back so Stripe will retry.
 *
 * Notes for future expansion:
 *   - Founder-rate selection happens here (not at session creation) — gated
 *     by an advisory-locked count of `founder_rate_grants`. Implementing in
 *     a follow-up turn alongside the dunning + downgrade handlers.
 *   - Welcome email via Resend + onboarding tour kickoff also live here.
 */
export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  if (session.mode !== 'subscription') {
    // We only create checkout sessions in subscription mode for the agent
    // tier. Non-subscription sessions are out of scope for v1.
    console.warn('[handleCheckoutSessionCompleted] non-subscription session ignored', session.id);
    return;
  }

  const userId = session.client_reference_id;
  if (!userId) {
    throw new Error(
      `Missing client_reference_id on checkout session ${session.id}; cannot bind to a user.`,
    );
  }

  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const stripeSubscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!stripeCustomerId || !stripeSubscriptionId) {
    throw new Error(
      `Checkout session ${session.id} completed without customer or subscription IDs.`,
    );
  }

  // Pull the full subscription object so we have plan_id, status, period_end.
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
  const stripePriceId = subscription.items.data[0]?.price.id;
  if (!stripePriceId) {
    throw new Error(`Subscription ${stripeSubscriptionId} has no items.`);
  }

  // Resolve our internal plan_id from the Stripe price ID. The plan must
  // already be seeded (see `scripts/seed-plans.ts`). `tier` and
  // `billing_period` are pulled too — the founder-rate eligibility check
  // below needs them.
  const supabase = createAdminClient();
  const { data: plan, error: planErr } = await supabase
    .from('plans')
    .select('id, listing_cap, seats_included, tier, billing_period')
    .eq('stripe_price_id', stripePriceId)
    .maybeSingle();
  if (planErr) throw planErr;
  if (!plan) {
    throw new Error(
      `No plan row matches Stripe price ${stripePriceId}; run pnpm db:seed.`,
    );
  }

  // Org name from session metadata. Slug is derived from the name +
  // collision-suffix loop; both happen inside the RPC now (was a JS
  // loop with N round-trips and a race window under concurrent retry).
  const orgName = session.metadata?.aho_org_name ?? 'My Organization';

  // Materialize the org + member + subscription atomically via the
  // 0021 SECURITY DEFINER RPC. The RPC wraps all three writes in a
  // single Postgres transaction — closes pre-live blocker #1 from
  // the strategic-doc audit (no more partial-state-on-retry that
  // produced duplicate orgs). Idempotent on stripe_subscription_id;
  // re-runs return the existing org/sub ids without re-inserting,
  // and refresh the mutable subscription fields. Slug uniqueness +
  // collision-suffix loop now lives inside the RPC.
  const subRaw = subscription as unknown as {
    current_period_start: number;
    current_period_end: number;
  };
  const { data: rpcRows, error: rpcErr } = await supabase.rpc(
    'materialize_subscription_from_checkout',
    {
      p_user_id: userId,
      p_org_name: orgName,
      p_slug_base: slugifyOrgName(orgName),
      p_plan_id: plan.id,
      p_listing_cap: plan.listing_cap,
      p_seats_included: plan.seats_included,
      p_stripe_customer_id: stripeCustomerId,
      p_stripe_subscription_id: stripeSubscriptionId,
      p_status: subscription.status,
      p_current_period_start: new Date(subRaw.current_period_start * 1000).toISOString(),
      p_current_period_end: new Date(subRaw.current_period_end * 1000).toISOString(),
      p_cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      p_trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    },
  );
  if (rpcErr) throw rpcErr;
  const rpcRow = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
  if (!rpcRow) {
    throw new Error('materialize_subscription_from_checkout returned no rows');
  }
  const ourSub = { id: rpcRow.subscription_id as string };

  // ============================================================
  // Founder-rate selection
  // ============================================================
  //
  // Per `docs/DECISIONS.md` "Founder-rate atomic claim", the gating logic is
  // a single atomic UPDATE on `founder_rate_counter` (via the SECURITY DEFINER
  // function `claim_founder_rate_slot()`). If the slot was acquired, we
  // update Stripe to switch the subscription's price to the founder price
  // ID. The 7-day trial covers the brief window where the price changes,
  // so the customer's first charge is at $19, not $29.
  //
  // Idempotent under retry: if a `founder_rate_grants` row already exists
  // for this subscription, skip everything (the original delivery already
  // claimed and applied).
  if (isFounderEligible(plan)) {
    await tryClaimFounderRate({
      supabase,
      stripe,
      ourSubscriptionId: ourSub.id as string,
      stripeSubscription: subscription,
      userId,
    });
  }
}

interface FounderClaimArgs {
  supabase: ReturnType<typeof createAdminClient>;
  stripe: ReturnType<typeof getStripeClient>;
  ourSubscriptionId: string;
  stripeSubscription: Stripe.Subscription;
  userId: string;
}

async function tryClaimFounderRate({
  supabase,
  stripe,
  ourSubscriptionId,
  stripeSubscription,
  userId,
}: FounderClaimArgs): Promise<void> {
  // Idempotency: skip if a grant already exists for this subscription.
  const { data: existingGrant } = await supabase
    .from('founder_rate_grants')
    .select('id')
    .eq('subscription_id', ourSubscriptionId)
    .maybeSingle();
  if (existingGrant) return;

  const founderPriceId = process.env.STRIPE_AGENT_FOUNDER_PRICE_ID;
  if (!founderPriceId) {
    console.warn(
      '[founder-rate] STRIPE_AGENT_FOUNDER_PRICE_ID not set; skipping claim. ' +
        'Run pnpm stripe:setup and update env.',
    );
    return;
  }

  // Atomic claim + grant via the 0022 SECURITY DEFINER function. The
  // counter increment and the grant INSERT happen in one transaction,
  // so a grant-insert failure rolls back the counter increment too.
  // Closes pre-live blocker #2 (the leaked-counter failure mode the
  // strategic-doc audit flagged).
  const { data: claimRows, error: claimErr } = await supabase.rpc(
    'claim_founder_rate_slot_with_grant',
    {
      p_subscription_id: ourSubscriptionId,
      p_user_id: userId,
      p_original_price_id: founderPriceId,
    },
  );
  if (claimErr) throw claimErr;
  const claimRow = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claimRow || claimRow.grant_id == null) {
    // Cap reached OR grant insert raced — customer stays on standard
    // price; this is fine, no leak.
    return;
  }

  const stripeItem = stripeSubscription.items.data[0];
  if (!stripeItem) {
    await supabase.rpc('release_founder_rate_slot', { p_subscription_id: ourSubscriptionId });
    throw new Error('subscription has no items; cannot apply founder price');
  }

  try {
    await stripe.subscriptions.update(stripeSubscription.id, {
      items: [{ id: stripeItem.id, price: founderPriceId }],
      proration_behavior: 'none',
    });
  } catch (e) {
    // Roll back: release the slot (deletes/marks grant + decrements counter).
    await supabase.rpc('release_founder_rate_slot', { p_subscription_id: ourSubscriptionId });
    throw e;
  }

  // Update our subscription row's plan_id to founder. The forthcoming
  // `customer.subscription.updated` event from the price change will also
  // converge on this state via the helper's plan-resolution lookup; doing
  // it here closes the inconsistency window.
  await supabase
    .from('subscriptions')
    .update({ plan_id: 'aho_agent_founder_monthly' })
    .eq('id', ourSubscriptionId);
}

// Slug uniqueness moved into the materialize_subscription_from_checkout
// RPC (migration 0021) so the slug pick + org insert happen inside the
// same Postgres transaction. The previous JS implementation did N
// round-trips and raced with concurrent webhook retries.
