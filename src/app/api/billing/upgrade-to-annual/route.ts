import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  performUpgradeToAnnual,
  resolveUpgradeEligibility,
} from '@/lib/billing/upgrade-to-annual';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/billing/upgrade-to-annual
 *
 * Switches the signed-in user's MONTHLY subscription to its tier's
 * ANNUAL price and (when eligible) attaches the WELCOME5 coupon.
 *
 * Two paths in one route:
 *   - `applyWelcome=true` in body → caller asserts the welcome bonus
 *     should be applied. Server VERIFIES the 3-day window via
 *     resolveUpgradeEligibility() before passing the flag down. Never
 *     trust client state for the coupon — Stripe applies it on the
 *     server side and we want this gate to enforce the marketing rule.
 *   - default (no welcome) → upgrade without coupon, just the always-on
 *     "2 months free" annual saving.
 *
 * Auth: signed-in user, owner of the subscription (RLS reads happen on
 * service-role via the eligibility resolver but the subscription's
 * stripe_id lookup is keyed on user_id, so a non-owner can't trigger
 * an upgrade of someone else's sub).
 *
 * Idempotency: Stripe subscription.update is idempotent on (sub_id,
 * items[0].price). Re-running the same upgrade just returns the same
 * sub state. Safe to retry on transient failures.
 */
export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { applyWelcome?: boolean };
  const wantWelcome = body.applyWelcome === true;

  const eligibility = await resolveUpgradeEligibility(userResult.user.id);
  if (!eligibility) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_eligible_subscription' },
      { status: 400 },
    );
  }

  // Server-side verification: client asked for welcome, but we ONLY
  // apply when the 3-day window is open per Stripe (the source of
  // truth for sub.created). Caller may pass true but we strip it
  // silently when the window has closed — no error, just no coupon.
  const applyWelcome = wantWelcome && eligibility.inWelcomeWindow;

  try {
    await performUpgradeToAnnual({ eligibility, applyWelcomeCoupon: applyWelcome });
  } catch (e) {
    console.error('[upgrade-to-annual]', e);
    return NextResponse.json(
      { ok: false, errorCode: 'stripe_update_failed' },
      { status: 500 },
    );
  }

  const pub = publicEnv();
  return NextResponse.json({
    ok: true,
    welcomeApplied: applyWelcome,
    redirectUrl: `${pub.NEXT_PUBLIC_SITE_URL}/en/onboarding/welcome?upgrade=annual${applyWelcome ? '&welcome=1' : ''}`,
  });
}
