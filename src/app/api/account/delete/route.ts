import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from '@/lib/billing/stripe';

export const runtime = 'edge';

/**
 * POST /api/account/delete
 *
 * GDPR right-to-erasure self-service. The signed-in user permanently
 * deletes their own account. To confirm intent, the client must echo
 * the user's own email address in the body — typo-protection without
 * adding a re-auth roundtrip.
 *
 * Server-side flow (in this order, fail-stop on any step):
 *   1. Cancel Stripe subscriptions for any org the user OWNS. Immediate
 *      cancel (no `at_period_end`) so the customer's right-to-erasure
 *      is honored without a billing-grace tail. Stripe customer record
 *      itself is preserved per Stripe TOS / accounting requirements
 *      (we just cut the subscription; no PII deletion request to Stripe
 *      is wired in v1 — open task in DECISIONS).
 *   2. Archive every property where created_by = self. Listings stay
 *      in the org with `status='archived'`; `created_by` is NULLed by
 *      the FK SET NULL clause from migration 0023. Same flow keeps
 *      audit/lead history coherent.
 *   3. supabase.auth.admin.deleteUser(userId). This:
 *        - removes auth.users (cascade → profiles row goes too)
 *        - cascades to organization_members (CASCADE from migration 0002)
 *        - cascades to saved_searches (CASCADE from 0010)
 *        - cascades to reviews ABOUT the user (CASCADE on agent_id)
 *        - SET NULLs reviews/audit_log/leads/subscriptions/founder_grants
 *          authored by the user (per migration 0023)
 *
 * Failure modes the client should handle:
 *   - 401 unauthenticated  — session is gone; no action needed.
 *   - 400 confirmation_mismatch — typed email doesn't match.
 *   - 502 stripe_cancel_failed — couldn't cancel a Stripe subscription
 *     (network blip / Stripe outage). Account NOT deleted; safe retry.
 *   - 502 supabase_delete_failed — auth user delete failed. Account NOT
 *     deleted (the prior steps did mutate state — listings are archived,
 *     subscriptions cancelled — that's recoverable but worth logging).
 *
 * Idempotency: if you call delete twice, the second call returns 401
 * because the session was destroyed by the first delete. The Stripe
 * cancellation flow is idempotent already (cancelled subscriptions
 * stay cancelled).
 */

const BodySchema = z.object({
  confirm_email: z.string().trim().min(3),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_body' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;
  const userEmail = userResult.user.email;

  // Confirmation: typed email must match (case-insensitive).
  if (
    !userEmail ||
    parsed.data.confirm_email.toLowerCase() !== userEmail.toLowerCase()
  ) {
    return NextResponse.json(
      { ok: false, errorCode: 'confirmation_mismatch' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 1. Cancel Stripe subscriptions for any org the user OWNS.
  //    Read all owner memberships; for each org with an active sub,
  //    cancel immediately. Other orgs (member but not owner) are
  //    untouched — the org keeps running for the remaining members.
  const { data: ownerships, error: ownErr } = await admin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('role', 'owner');
  if (ownErr) {
    console.error('[account/delete] owner lookup failed', ownErr);
    return NextResponse.json(
      { ok: false, errorCode: 'lookup_failed' },
      { status: 500 },
    );
  }

  const ownedOrgIds = (ownerships ?? []).map((o) => o.org_id);
  if (ownedOrgIds.length > 0) {
    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('id, stripe_subscription_id, status')
      .in('org_id', ownedOrgIds)
      .not('stripe_subscription_id', 'is', null);
    if (subErr) {
      console.error('[account/delete] sub lookup failed', subErr);
      return NextResponse.json(
        { ok: false, errorCode: 'lookup_failed' },
        { status: 500 },
      );
    }

    const stripe = getStripeClient();
    for (const sub of subs ?? []) {
      // Skip already-terminal Stripe statuses to avoid the noisy 400.
      if (
        sub.status === 'canceled' ||
        sub.status === 'incomplete_expired'
      ) {
        continue;
      }
      try {
        await stripe.subscriptions.cancel(sub.stripe_subscription_id!);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'unknown';
        // If Stripe says "subscription is already canceled", treat as ok.
        if (msg.toLowerCase().includes('already canceled')) continue;
        console.error('[account/delete] stripe cancel failed', sub.id, e);
        return NextResponse.json(
          { ok: false, errorCode: 'stripe_cancel_failed' },
          { status: 502 },
        );
      }
    }
  }

  // 2. Archive properties created by the user. The created_by FK becomes
  //    NULL on user delete (migration 0023), but archiving here keeps
  //    them out of the public surface immediately.
  const { error: archiveErr } = await admin
    .from('properties')
    .update({ status: 'archived' })
    .eq('created_by', userId)
    .not('status', 'in', '("archived","sold","rented")');
  if (archiveErr) {
    console.error('[account/delete] archive failed', archiveErr);
    return NextResponse.json(
      { ok: false, errorCode: 'archive_failed' },
      { status: 500 },
    );
  }

  // 3. Hard delete the auth user. Cascades through profile/membership/
  //    saved-searches/reviews-about-the-user; FK-SET-NULL handles the
  //    rest (audit_log/leads/subscriptions/founder_grants).
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error('[account/delete] auth deleteUser failed', delErr);
    return NextResponse.json(
      { ok: false, errorCode: 'supabase_delete_failed' },
      { status: 502 },
    );
  }

  // The session cookie on the caller is still set, but its user is
  // gone — supabase will treat the session as invalid on next request.
  // We don't actively sign out here because the auth user is already
  // deleted; sign-out would 401. Client redirects to /{locale} which
  // will re-render in anon state.
  return NextResponse.json({ ok: true });
}
