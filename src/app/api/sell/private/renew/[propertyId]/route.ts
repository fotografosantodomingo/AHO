import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createPrivateListingCheckoutSession } from '@/lib/billing/private-listing-checkout';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/locale-path';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * GET /api/sell/private/renew/[propertyId]
 *
 * Email-button entrypoint for renewing a $5 private-owner listing.
 * Designed to be a plain `<a href>` target from the renewal-reminder
 * and expired emails (Track E) — no JSON body, no JS — so it has to
 * be a GET that 302-redirects to Stripe Checkout.
 *
 * Flow:
 *   1. Resolve the user's session. If not signed in, redirect to
 *      /signin with a `?redirect=` back to this URL so the user lands
 *      back in the renewal flow after authenticating.
 *   2. Look up the property (via the user's RLS-scoped client — RLS
 *      gates ownership). If the property is missing or not visible,
 *      redirect to /dashboard/properties with an error toast.
 *   3. Verify `published_via='private_purchase'` — agents shouldn't
 *      be paying $5 to renew their subscription-managed listings.
 *      If mismatched, redirect to /dashboard/properties with an
 *      error toast (the agent flow has its own renewal mechanism
 *      through the Stripe Customer Portal).
 *   4. Create a Stripe Checkout Session via the shared helper with
 *      `renewalPropertyId` set so the webhook bumps `expires_at` on
 *      the existing property rather than creating a fresh listing.
 *   5. 302-redirect to the Checkout Session URL.
 *
 * Locale: read from the `?locale=` query param if present (the email
 * templates pass it), otherwise default to the first supported locale
 * the browser advertises via Accept-Language, otherwise EN.
 *
 * Ownership: enforced by RLS on the `properties` SELECT — the user's
 * session client (not service-role) is what runs the query, so a
 * row coming back at all means the user is allowed to see it. The
 * subsequent `published_via` check is a second-line safety net.
 */

const ERROR_DEST = '/dashboard/properties';

function pickLocale(req: NextRequest): Locale {
  const q = req.nextUrl.searchParams.get('locale');
  if (q && (LOCALES as readonly string[]).includes(q)) return q as Locale;
  const accept = req.headers.get('accept-language') ?? '';
  for (const candidate of accept.split(',')) {
    const tag = candidate.split(';')[0]?.trim().slice(0, 2).toLowerCase();
    if (tag && (LOCALES as readonly string[]).includes(tag)) return tag as Locale;
  }
  return 'en';
}

function errorRedirect(siteOrigin: string, locale: Locale, code: string): NextResponse {
  const url = new URL(localePath(locale, ERROR_DEST), siteOrigin);
  url.searchParams.set('renew_error', code);
  return NextResponse.redirect(url.toString(), { status: 302 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  const { propertyId } = await params;
  const locale = pickLocale(req);
  const siteOrigin = publicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    // Bounce through sign-in so the user can come back to this same
    // URL post-auth. Same pattern as the other auth-gated routes.
    const signinUrl = new URL(localePath(locale, '/signin'), siteOrigin);
    signinUrl.searchParams.set(
      'redirect',
      `/api/sell/private/renew/${propertyId}?locale=${locale}`,
    );
    return NextResponse.redirect(signinUrl.toString(), { status: 302 });
  }
  const user = userResult.user;
  if (!user.email) {
    return errorRedirect(siteOrigin, locale, 'email_required');
  }

  // RLS-scoped lookup. A row coming back means the user is allowed
  // to see it; missing = not the owner OR not a member of the org.
  // Both cases fold into the same not_found / unauthorized response —
  // we don't want to leak whether the property exists.
  const { data: property, error: propertyErr } = await supabase
    .from('properties')
    .select('id, published_via, status, org_id, created_by')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyErr) {
    console.error('[renew] property lookup failed', {
      propertyId,
      code: propertyErr.code,
      message: propertyErr.message,
    });
    return errorRedirect(siteOrigin, locale, 'lookup_failed');
  }
  if (!property) {
    return errorRedirect(siteOrigin, locale, 'not_found');
  }

  if (property.published_via !== 'private_purchase') {
    // Agent-subscription listings renew via the Stripe Customer
    // Portal, not this endpoint. Redirect with an explanatory code
    // the toast can localize.
    return errorRedirect(siteOrigin, locale, 'not_private');
  }

  try {
    const { url } = await createPrivateListingCheckoutSession({
      userId: user.id,
      userEmail: user.email,
      locale,
      renewalPropertyId: propertyId,
    });
    return NextResponse.redirect(url, { status: 302 });
  } catch (e) {
    console.error('[renew] checkout session create failed', {
      propertyId,
      userId: user.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return errorRedirect(siteOrigin, locale, 'session_create_failed');
  }
}
