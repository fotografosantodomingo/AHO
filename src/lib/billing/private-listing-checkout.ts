import 'server-only';
import { z } from 'zod';
import { getStripeClient } from './stripe';
import { publicEnv } from '@/lib/env';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/locale-path';

/**
 * Stripe Checkout session creation for the $5 private-owner listing.
 *
 * Per docs/SELL_FUNNEL_PLAN.md Track D:
 *   - mode='payment' (NOT subscription) — single $5 charge.
 *   - Price = STRIPE_PRICE_PRIVATE_LISTING_ONE_TIME (set after running
 *     pnpm stripe:setup; see scripts/setup-stripe-products.ts).
 *   - success_url → /{locale}/sell/private/success?session_id=…
 *   - cancel_url  → /{locale}/sell/private/cancel
 *   - client_reference_id → user id (so the webhook can link the
 *     resulting listing_purchases row to the buyer's profile).
 *   - metadata.aho_purpose = 'private_listing' → the webhook dispatch
 *     branches on this to insert a listing_purchases row rather than
 *     fall through to the (subscription-only) materialize-org path.
 *
 * Renewal case: when `renewalPropertyId` is set, the resulting purchase
 * row is linked to the existing property at webhook time and the
 * property's `expires_at` is bumped to paid_at + PRIVATE_LISTING_DURATION_DAYS (see
 * `src/lib/billing/private-listing-constants.ts`). First-time
 * purchases pass null.
 */

export const PrivateListingCheckoutLocale = z.enum(LOCALES);
export type PrivateListingCheckoutLocale = z.infer<
  typeof PrivateListingCheckoutLocale
>;

export const CreatePrivateListingCheckoutSessionInput = z.object({
  userId: z.string().uuid(),
  userEmail: z.string().email(),
  locale: PrivateListingCheckoutLocale,
  /** Property id being renewed; omit for first-time purchases. */
  renewalPropertyId: z.string().uuid().optional(),
});
export type CreatePrivateListingCheckoutSessionInput = z.infer<
  typeof CreatePrivateListingCheckoutSessionInput
>;

export interface CreatePrivateListingCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export async function createPrivateListingCheckoutSession(
  input: CreatePrivateListingCheckoutSessionInput,
): Promise<CreatePrivateListingCheckoutSessionResult> {
  const stripe = getStripeClient();
  const pub = publicEnv();

  const priceId = process.env.STRIPE_PRICE_PRIVATE_LISTING_ONE_TIME;
  if (!priceId) {
    throw new Error(
      'STRIPE_PRICE_PRIVATE_LISTING_ONE_TIME is not set. Run pnpm stripe:setup and copy the env snippet into Cloudflare Pages.',
    );
  }

  const locale = input.locale as Locale;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    client_reference_id: input.userId,
    customer_email: input.userEmail,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      buyer_user_id: input.userId,
      aho_purpose: 'private_listing',
      // Empty string rather than undefined so the metadata key is
      // ALWAYS present at webhook time — simpler dispatch logic.
      renewal_property_id: input.renewalPropertyId ?? '',
    },
    success_url: `${pub.NEXT_PUBLIC_SITE_URL}${localePath(locale, '/sell/private/success')}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${pub.NEXT_PUBLIC_SITE_URL}${localePath(locale, '/sell/private/cancel')}`,
    automatic_tax: { enabled: true },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error('Stripe returned a session without a redirect URL.');
  }

  return { sessionId: session.id, url: session.url };
}
