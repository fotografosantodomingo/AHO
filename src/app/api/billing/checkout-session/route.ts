import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  CheckoutLocale,
  CheckoutPlan,
  createAgentCheckoutSession,
} from '@/lib/billing/checkout';
import { z } from 'zod';

export const runtime = 'edge';

/**
 * POST /api/billing/checkout-session
 *
 * Creates a Stripe Checkout Session for the AHO Agent tier (monthly or
 * annual) and returns the redirect URL. The caller (`/pricing` page or the
 * agent signup flow) should `window.location.assign(url)` to push the user
 * onto Stripe Checkout.
 *
 * Auth: caller must be a signed-in user. The user's email + ID is fetched
 * from the Supabase session — the request body only carries the plan and
 * the org name they want.
 *
 * Idempotency: not enforced at this layer. Repeated POSTs return distinct
 * session IDs; that's fine because each session has its own URL and the
 * webhook is the source of truth (idempotent on its own event ID). Users
 * who back out of Checkout and try again get a fresh session.
 */

const RequestSchema = z.object({
  plan: CheckoutPlan,
  orgName: z.string().min(2).max(120),
  locale: CheckoutLocale,
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
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
    // Shouldn't happen for email/password and OAuth signups; defensive.
    return NextResponse.json({ error: 'email_required' }, { status: 400 });
  }

  try {
    const result = await createAgentCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      plan: parsed.data.plan,
      orgName: parsed.data.orgName,
      locale: parsed.data.locale,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error('[checkout-session]', e);
    return NextResponse.json(
      { error: 'session_create_failed' },
      { status: 500 },
    );
  }
}
