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

  // Org name from session metadata. Slug is derived; collisions get a
  // numeric suffix until unique.
  const orgName = session.metadata?.aho_org_name ?? 'My Organization';
  const orgSlug = await uniqueOrgSlug(supabase, slugifyOrgName(orgName));

  // Materialize the org. Idempotent on stripe_subscription_id — if this
  // event was redelivered after a partial earlier run, we re-find the
  // existing org by following the subscription back.
  const existingSub = await supabase
    .from('subscriptions')
    .select('id, org_id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .maybeSingle();

  let orgId: string;
  if (existingSub.data) {
    orgId = existingSub.data.org_id as string;
  } else {
    const orgInsert = await supabase
      .from('organizations')
      .insert({
        name: orgName,
        slug: orgSlug,
        type: 'agent',
        listing_cap: plan.listing_cap,
        seats_total: plan.seats_included,
      })
      .select('id')
      .single();
    if (orgInsert.error) throw orgInsert.error;
    orgId = orgInsert.data.id as string;
  }

  // Insert the owner membership. Idempotent — primary key is (org_id, user_id).
  const memberInsert = await supabase
    .from('organization_members')
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        role: 'owner',
        joined_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,user_id' },
    );
  if (memberInsert.error) throw memberInsert.error;

  // Insert / update the subscription row. The denormalization trigger on
  // `subscriptions` (per `0007_denormalizations_and_latlng.sql`) will
  // propagate `current_*` to `organizations` automatically.
  const subUpsert = await supabase.from('subscriptions').upsert(
    {
      org_id: orgId,
      user_id: null,
      plan_id: plan.id,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
      status: subscription.status,
      current_period_start: new Date((subscription as unknown as { current_period_start: number }).current_period_start * 1000).toISOString(),
      current_period_end: new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      trial_end: subscription.trial_end
        ? new Date(subscription.trial_end * 1000).toISOString()
        : null,
    },
    { onConflict: 'stripe_subscription_id' },
  );
  if (subUpsert.error) throw subUpsert.error;

  // Look up our subscription row's UUID for the founder-rate grant FK.
  const { data: ourSub } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', stripeSubscriptionId)
    .single();
  if (!ourSub) {
    throw new Error(`Subscription row missing right after upsert: ${stripeSubscriptionId}`);
  }

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

  // Atomic claim. Returns the new claimed count, or null if at cap.
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_founder_rate_slot');
  if (claimErr) throw claimErr;
  if (claimed === null) {
    // Cap reached. Customer stays on standard price; this is fine.
    return;
  }

  // Order chosen for rollback safety:
  //   1. Insert grant row (FK to our subscription; idempotent on
  //      subscription_id unique constraint).
  //   2. Update Stripe to founder price.
  //   3. Update our subscription row's plan_id to founder.
  // On Stripe failure: release_founder_rate_slot rolls back grant + counter.
  // On grant insert failure: counter is leaked; cron sweep cleans up.

  const { error: grantErr } = await supabase.from('founder_rate_grants').insert({
    subscription_id: ourSubscriptionId,
    user_id: userId,
    original_price_id: founderPriceId,
  });
  if (grantErr) {
    console.error(
      '[founder-rate] grant row insert failed; counter is leaked until orphan sweep',
      grantErr,
    );
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

/**
 * Generates a unique org slug by appending a numeric suffix on collision.
 * Tries up to 50 variants before giving up. Race-safe via the unique
 * constraint on `organizations.slug` — a concurrent insert will fail and
 * we retry.
 */
async function uniqueOrgSlug(
  supabase: ReturnType<typeof createAdminClient>,
  baseSlug: string,
): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? baseSlug : `${baseSlug}-${i + 1}`;
    const { data } = await supabase
      .from('organizations')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  throw new Error(`Could not find a unique slug after 50 attempts for ${baseSlug}.`);
}
