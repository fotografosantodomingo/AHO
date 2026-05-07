import 'server-only';
import { z } from 'zod';
import { getStripeClient } from './stripe';
import { publicEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { LOCALES } from '@/i18n/config';

/**
 * Stripe Checkout session creation for the AHO Agent paid tier.
 *
 * Flow per HANDOFF §7.3:
 *   1. User on /pricing picks monthly or annual.
 *   2. This module creates a Checkout Session with:
 *        - `client_reference_id = userId`  (so the webhook knows the user)
 *        - `metadata.org_name` / `metadata.plan_id`  (so the webhook can
 *          materialize the org and pick the right plan id)
 *   3. User completes payment on Stripe.
 *   4. Stripe sends `checkout.session.completed` → webhook creates the
 *      org + subscription + organization_members(owner) atomically.
 *   5. Stripe redirects to `/onboarding/welcome?session_id=...`.
 *
 * Founder-rate selection is intentionally NOT applied here — the price is
 * always the standard monthly or annual at session creation. Founder-rate
 * gating runs at webhook time inside the advisory-lock-protected counter
 * (per `DECISIONS.md` "Founder-rate pricing is application-gated"). This
 * trades a small UX cost (we can't show "you got the founder rate" before
 * payment) for robustness — abandoned sessions don't waste slots.
 */

export const CheckoutPlan = z.enum(['monthly', 'annual']);
export type CheckoutPlan = z.infer<typeof CheckoutPlan>;

export const CheckoutTier = z.enum(['agent', 'plus', 'pro_automation']);
export type CheckoutTier = z.infer<typeof CheckoutTier>;

export const CheckoutLocale = z.enum(LOCALES);
export type CheckoutLocale = z.infer<typeof CheckoutLocale>;

export const CreateCheckoutSessionInput = z.object({
  userId: z.string().uuid(),
  userEmail: z.string().email(),
  /** Tier: agent ($29) / plus ($49) / pro_automation ($99). */
  tier: CheckoutTier,
  /** Billing period: monthly or annual. */
  plan: CheckoutPlan,
  /** Org display name from the signup form (free text; slug is derived later). */
  orgName: z.string().min(2).max(120),
  /** Caller's active locale — used to localize the post-Checkout return URL. */
  locale: CheckoutLocale,
});
export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionInput>;

/** Resolves the Stripe price ID for a given tier + period combo from
 *  the env vars seeded by `pnpm stripe:setup` and persisted to
 *  Cloudflare Pages secrets. Throws if the env var is missing. */
function resolvePriceId(tier: CheckoutTier, plan: CheckoutPlan): string {
  const map: Record<string, string | undefined> = {
    agent_monthly: process.env.STRIPE_AGENT_MONTHLY_PRICE_ID,
    agent_annual: process.env.STRIPE_AGENT_ANNUAL_PRICE_ID,
    plus_monthly: process.env.STRIPE_PLUS_MONTHLY_PRICE_ID,
    plus_annual: process.env.STRIPE_PLUS_ANNUAL_PRICE_ID,
    pro_automation_monthly: process.env.STRIPE_PRO_AUTOMATION_MONTHLY_PRICE_ID,
    pro_automation_annual: process.env.STRIPE_PRO_AUTOMATION_ANNUAL_PRICE_ID,
  };
  const key = `${tier}_${plan}`;
  const priceId = map[key];
  if (!priceId) {
    throw new Error(`Missing Stripe price env var for ${key}.`);
  }
  return priceId;
}

export interface CreateCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export async function createAgentCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const stripe = getStripeClient();
  const pub = publicEnv();

  // Pick the price ID from env via the tier+period map.
  const priceId = resolvePriceId(input.tier, input.plan);

  // Look up an existing Stripe customer for the user (idempotent across
  // checkout retries). We look in our `subscriptions` table first; if the
  // user has never had a Stripe customer, Checkout creates one and we
  // capture it from the webhook.
  const supabase = createAdminClient();
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', input.userId)
    .maybeSingle();

  // We deliberately do NOT pre-create a Stripe customer. Stripe creates
  // one as part of the Checkout Session and tells us about it in the
  // webhook. Pre-creating leaks customer rows on abandoned signups.

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    client_reference_id: input.userId,
    customer_email: existing ? undefined : input.userEmail,
    customer: existing?.stripe_customer_id ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      aho_user_id: input.userId,
      aho_tier: input.tier,
      aho_plan: input.plan,
      aho_org_name: input.orgName,
    },
    subscription_data: {
      metadata: {
        aho_user_id: input.userId,
        aho_tier: input.tier,
        aho_plan: input.plan,
      },
    },
    success_url: `${pub.NEXT_PUBLIC_SITE_URL}/${input.locale}/${input.locale === 'es' ? 'inicio/bienvenida' : 'onboarding/welcome'}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${pub.NEXT_PUBLIC_SITE_URL}/${input.locale}/${input.locale === 'es' ? 'precios' : 'pricing'}?canceled=1`,
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error('Stripe returned a session without a redirect URL.');
  }

  return { sessionId: session.id, url: session.url };
}
