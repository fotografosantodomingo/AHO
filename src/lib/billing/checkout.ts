import 'server-only';
import { z } from 'zod';
import { getStripeClient } from './stripe';
import { publicEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

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

export const CheckoutLocale = z.enum(['en', 'es']);
export type CheckoutLocale = z.infer<typeof CheckoutLocale>;

export const CreateCheckoutSessionInput = z.object({
  userId: z.string().uuid(),
  userEmail: z.string().email(),
  plan: CheckoutPlan,
  /** Org display name from the signup form (free text; slug is derived later). */
  orgName: z.string().min(2).max(120),
  /** Caller's active locale — used to localize the post-Checkout return URL. */
  locale: CheckoutLocale,
});
export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionInput>;

export interface CreateCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export async function createAgentCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const stripe = getStripeClient();
  const pub = publicEnv();

  // Pick the price ID from env. Plans are seeded in `public.plans` referencing
  // these same IDs (see `scripts/seed-plans.ts` + `STRIPE_AGENT_*_PRICE_ID`
  // env vars). Verify the env is populated before we attempt the API call —
  // Stripe rejects bare-string price IDs that don't match a real price.
  const priceId =
    input.plan === 'monthly'
      ? process.env.STRIPE_AGENT_MONTHLY_PRICE_ID
      : process.env.STRIPE_AGENT_ANNUAL_PRICE_ID;

  if (!priceId) {
    throw new Error(
      `Missing STRIPE_AGENT_${input.plan.toUpperCase()}_PRICE_ID env var.`,
    );
  }

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
      aho_plan: input.plan,
      aho_org_name: input.orgName,
    },
    subscription_data: {
      metadata: {
        aho_user_id: input.userId,
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
