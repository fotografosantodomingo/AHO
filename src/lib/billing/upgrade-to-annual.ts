import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from './stripe';

/**
 * Server-side resolver: can the signed-in user upgrade to annual right
 * now, and is the WELCOME5 (3-day post-first-payment) discount still
 * eligible for them?
 *
 * Returns a single object the upgrade page + the upgrade API both use.
 * Pure read — no Stripe mutations here.
 *
 * Rules:
 *   - User must own a subscription via our `subscriptions` table
 *     (no Stripe id → null result → upgrade not available)
 *   - Current price must be MONTHLY (no annual → no upgrade)
 *   - Welcome eligibility: NOW < sub.created + 3 days. Stripe is the
 *     source of truth for sub.created (we fresh-fetch). Don't trust
 *     a client query string for the discount — verify here.
 */

export interface UpgradeEligibility {
  /** Stripe subscription id (sub_xxx). */
  stripeSubscriptionId: string;
  /** Subscription item id (si_xxx) — needed for the items[0].id field
   *  in subscription.update to swap the price without losing the item. */
  itemId: string;
  /** Current monthly price id. Useful for the page copy ("you'll switch
   *  from $X/mo to $Y/yr"). */
  currentPriceId: string;
  /** The annual price id we will switch to. Picked from env per the
   *  tier metadata stored on the subscription. */
  annualPriceId: string;
  /** Plan tier — 'agent' / 'plus' / 'pro_automation'. */
  tier: 'agent' | 'plus' | 'pro_automation';
  /** True when NOW < sub.created + 3 days. The route uses this to
   *  decide whether to attach the WELCOME5 coupon. */
  inWelcomeWindow: boolean;
  /** Cents for the current monthly price (per period, ex-tax). */
  monthlyCents: number;
  /** Cents for the annual price we'd switch to. */
  annualCents: number;
  /** ISO 4217 currency code. */
  currency: string;
}

// Stripe price IDs are read directly from process.env — they're not in
// the zod-validated serverEnv block (price IDs vary between TEST and
// LIVE Stripe environments and aren't worth schema-enforcing). Returns
// the price string or null when env not set.
function annualPriceIdForTier(tier: UpgradeEligibility['tier']): string | null {
  const key =
    tier === 'agent'
      ? 'STRIPE_AGENT_ANNUAL_PRICE_ID'
      : tier === 'plus'
        ? 'STRIPE_PLUS_ANNUAL_PRICE_ID'
        : 'STRIPE_PRO_AUTOMATION_ANNUAL_PRICE_ID';
  return process.env[key] ?? null;
}

export async function resolveUpgradeEligibility(
  userId: string,
): Promise<UpgradeEligibility | null> {
  const supabase = createAdminClient();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, plan_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!sub?.stripe_subscription_id) return null;

  const stripe = getStripeClient();
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id as string);
  const item = stripeSub.items.data[0];
  if (!item) return null;
  const price = item.price;
  if (price.recurring?.interval !== 'month') {
    // Already on annual (or unsupported interval) → no upgrade path.
    return null;
  }

  // Derive tier from the subscription metadata (set at checkout). The
  // plan_id column also has it but the Stripe-side metadata is more
  // resilient to past schema drift.
  const tierMeta =
    (stripeSub.metadata?.aho_tier as UpgradeEligibility['tier'] | undefined) ??
    inferTierFromPlanId((sub.plan_id as string | null) ?? null);
  if (!tierMeta) return null;

  const annualPriceId = annualPriceIdForTier(tierMeta);
  if (!annualPriceId) {
    console.warn(`[upgrade] no annual price for tier ${tierMeta} (env missing)`);
    return null;
  }

  // Lookup the annual price to surface its amount on the confirmation
  // page. One extra Stripe call but the page is gated anyway.
  const annualPrice = await stripe.prices.retrieve(annualPriceId);

  // Welcome window — 3 days from sub creation (= first paid invoice).
  const createdMs = (stripeSub.created ?? Date.now() / 1000) * 1000;
  const inWelcomeWindow = Date.now() - createdMs < 3 * 24 * 60 * 60 * 1000;

  return {
    stripeSubscriptionId: stripeSub.id,
    itemId: item.id,
    currentPriceId: price.id,
    annualPriceId,
    tier: tierMeta,
    inWelcomeWindow,
    monthlyCents: price.unit_amount ?? 0,
    annualCents: annualPrice.unit_amount ?? 0,
    currency: (price.currency ?? 'usd').toUpperCase(),
  };
}

/**
 * Plan-id → tier inference. Used when subscription metadata lost the
 * tier hint (older subs created before we started writing aho_tier).
 */
function inferTierFromPlanId(
  planId: string | null,
): UpgradeEligibility['tier'] | null {
  if (!planId) return null;
  if (planId.includes('pro_automation')) return 'pro_automation';
  if (planId.includes('plus')) return 'plus';
  if (planId.includes('agent')) return 'agent';
  return null;
}

/**
 * Execute the upgrade — switches the subscription to the annual price
 * and (optionally) attaches the WELCOME5 coupon. Caller must have
 * already verified eligibility via resolveUpgradeEligibility().
 *
 * Stripe semantics: subscription.update with items[].id + items[].price
 * swaps the price; proration_behavior='create_prorations' generates the
 * proration credit (= the unused portion of the just-paid month) and
 * issues the next invoice immediately with the proration applied. The
 * coupon (when attached) reduces that invoice by 5%.
 *
 * Returns the updated Stripe subscription so the caller can extract
 * the next invoice id / redirect URL.
 */
export async function performUpgradeToAnnual(args: {
  eligibility: UpgradeEligibility;
  /** Apply WELCOME5 coupon. Caller checks eligibility.inWelcomeWindow
   *  before passing true (don't trust ambient state). */
  applyWelcomeCoupon: boolean;
}) {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(args.eligibility.stripeSubscriptionId, {
    items: [
      {
        id: args.eligibility.itemId,
        price: args.eligibility.annualPriceId,
      },
    ],
    proration_behavior: 'create_prorations',
    // discounts[] replaces the deprecated `coupon` field. Empty array
    // when not applying any (Stripe interprets that as "remove existing
    // discounts" — which is what we want; the prior monthly discounts
    // shouldn't carry into annual).
    discounts: args.applyWelcomeCoupon ? [{ coupon: 'WELCOME5' }] : [],
    metadata: {
      ...(args as unknown as { metadata?: Record<string, string> }).metadata,
      aho_upgrade_path: 'monthly_to_annual',
      aho_upgrade_at: new Date().toISOString(),
      ...(args.applyWelcomeCoupon ? { aho_welcome_coupon: 'WELCOME5' } : {}),
    },
  });
}
