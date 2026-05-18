import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  PrivateListingCheckoutLocale,
  createPrivateListingCheckoutSession,
} from '@/lib/billing/private-listing-checkout';

export const runtime = 'edge';

/**
 * POST /api/sell/private/checkout-session
 *
 * Creates a Stripe Checkout Session for the $5 private-owner listing
 * (mode='payment', not 'subscription') and returns its redirect URL.
 *
 * Auth: signed-in users only. The `buyer_user_id` from the user's
 * profile is the FK for the `listing_purchases` row the webhook
 * creates on `checkout.session.completed`.
 *
 * Body (all optional):
 *   propertyId    — uuid of an existing listing being RENEWED. Forwarded
 *                   to Stripe metadata so the webhook bumps that
 *                   property's expires_at + flips status back to active.
 *   locale        — caller's active locale, used to localize the success
 *                   and cancel URLs. Defaults to 'en'.
 *
 * Idempotency: NOT enforced here. Repeated POSTs return distinct session
 * IDs and that's fine — each session is its own URL, and the webhook is
 * idempotent on event id. Per the existing /api/billing/checkout-session
 * convention.
 *
 * Per docs/SELL_FUNNEL_PLAN.md Track D.
 */

const RequestSchema = z.object({
  propertyId: z.string().uuid().optional(),
  locale: PrivateListingCheckoutLocale.optional(),
});

export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = RequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const user = userResult.user;
  if (!user.email) {
    // Defensive — every email/password and OAuth signup sets email.
    return NextResponse.json({ error: 'email_required' }, { status: 400 });
  }

  try {
    const result = await createPrivateListingCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      locale: parsed.data.locale ?? 'en',
      renewalPropertyId: parsed.data.propertyId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error('[private-listing checkout-session]', e);
    return NextResponse.json(
      { error: 'session_create_failed' },
      { status: 500 },
    );
  }
}
