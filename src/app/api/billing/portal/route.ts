import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStripeClient } from '@/lib/billing/stripe';
import { publicEnv } from '@/lib/env';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/locale-path';

const PortalRequestSchema = z
  .object({
    /** Active locale at click time. Threaded into Stripe's `return_url`
     *  so the user lands back in the locale they were browsing — without
     *  this, non-EN users get bounced to `/dashboard` (which only resolves
     *  in EN) instead of e.g. `/panel`. Defaults to 'en' for callers that
     *  haven't been updated yet. Accepts every locale AHO renders so users
     *  on PL/PT/DE/FR/IT pages don't 400. */
    locale: z.enum(LOCALES).optional(),
    /** Optional deep-link into a specific portal flow. Today only
     *  `subscription_update` is supported — sends the user straight to
     *  the "change my plan" screen instead of the portal home. Used by
     *  the pricing-tier "Switch to X" buttons so existing subscribers
     *  don't have to navigate the portal manually to upgrade/downgrade.
     *  When unset, the portal opens to its home as before. */
    flow: z.enum(['subscription_update']).optional(),
  })
  .strict();

export const runtime = 'edge';

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for the signed-in user's owned
 * org and returns the redirect URL. The agent dashboard's "manage billing"
 * / "upgrade plan" / "cancel subscription" buttons all hit this endpoint.
 *
 * Auth: caller must be signed in AND must be the **owner** of an org. v1
 * gates billing self-service to owners only — other roles see read-only
 * billing info in the dashboard but don't get the portal link. This avoids
 * a non-owner accidentally cancelling on the org's behalf.
 *
 * The Stripe Customer Portal handles:
 *   - Plan upgrades / downgrades (with proration on upgrade, period-end
 *     scheduling on downgrade) — configured in the Stripe Customer Portal
 *     settings, not here.
 *   - Payment method updates.
 *   - Invoice history download.
 *   - Subscription cancellation (cancels at period end by default).
 *
 * The `customer.subscription.updated` and `customer.subscription.deleted`
 * webhooks reflect any changes back into our DB.
 */
export async function POST(req: NextRequest) {
  // Optional JSON body { locale?, flow? }. We tolerate empty body for
  // backwards compatibility with the original callers that POSTed
  // nothing. Locale accepts every URL-routable locale; only ES has a
  // localized dashboard path (`/panel`), so the URL ternary below
  // already handles the wide set.
  let locale: Locale = 'en';
  let flow: 'subscription_update' | null = null;
  try {
    const text = await req.text();
    if (text.trim().length > 0) {
      const parsed = PortalRequestSchema.safeParse(JSON.parse(text));
      if (parsed.success) {
        if (parsed.data.locale) locale = parsed.data.locale;
        if (parsed.data.flow) flow = parsed.data.flow;
      }
    }
  } catch {
    // Body was unparseable JSON — fall through with defaults.
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // Find the user's owned org(s). RLS on organization_members allows the
  // user to read their own memberships, so the user-context client is fine here.
  const { data: ownerships, error: ownErr } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .eq('role', 'owner');

  if (ownErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!ownerships || ownerships.length === 0) {
    return NextResponse.json({ error: 'no_owned_org' }, { status: 403 });
  }

  // v1: a user typically owns one org. If multiple, take the first; the
  // dashboard UI will surface the org selector before this endpoint fires.
  const orgId = ownerships[0]!.org_id;

  // Look up the Stripe customer + subscription IDs for that org.
  // Subscriptions table is RLS-gated, but org members CAN see their own
  // org's row — could use the user-context client here. Using admin for
  // explicitness about which path does the lookup. The
  // `stripe_subscription_id` is required for the `subscription_update`
  // flow; fine to be NULL for the default portal-home flow (the customer
  // could have a Stripe customer record without an active sub).
  const admin = createAdminClient();
  const { data: sub, error: subErr } = await admin
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('org_id', orgId)
    .maybeSingle();

  if (subErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'no_subscription' }, { status: 404 });
  }

  const stripe = getStripeClient();
  const pub = publicEnv();
  try {
    const params: Parameters<typeof stripe.billingPortal.sessions.create>[0] = {
      customer: sub.stripe_customer_id,
      return_url: `${pub.NEXT_PUBLIC_SITE_URL}${localePath(locale, '/dashboard')}`,
    };
    if (flow === 'subscription_update') {
      // Stripe requires the subscription id for the change-plan flow.
      // Fall through to the default portal home if we don't have one
      // (customer record exists but no active sub) — the user can pick
      // a plan from the portal manually rather than 4xx-ing here.
      if (sub.stripe_subscription_id) {
        params.flow_data = {
          type: 'subscription_update',
          subscription_update: {
            subscription: sub.stripe_subscription_id,
          },
        };
      }
    }
    const portal = await stripe.billingPortal.sessions.create(params);
    return NextResponse.json({ url: portal.url });
  } catch (e) {
    console.error('[billing/portal]', e);
    return NextResponse.json(
      { error: 'portal_create_failed' },
      { status: 500 },
    );
  }
}
