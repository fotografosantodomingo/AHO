import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv, serverEnv } from '@/lib/env';
import {
  exchangeCode,
  exchangeForLongLived,
  fetchMe,
  fetchPages,
  META_SCOPES,
} from '@/lib/oauth/meta';
import { verifyState, STATE_COOKIE } from '@/lib/oauth/state';

export const runtime = 'edge';

/**
 * GET /api/oauth/meta/callback
 *
 * Step 3 of the OAuth flow: receive `?code=…&state=…` from Facebook
 * after the user authorizes our app. We:
 *   1. Verify the signed state cookie matches the `state` query param
 *      (CSRF check).
 *   2. Exchange the code for a short-lived user access token.
 *   3. Exchange short-lived for long-lived (~60d) user access token.
 *   4. Fetch the FB user id + the user's managed Pages (with their
 *      Page tokens + linked IG Business accounts).
 *   5. Encrypted-upsert each token into `ad_platform_tokens`:
 *        - one `meta` row keyed on the FB user id (long-lived user token)
 *        - one row per FB Page (page token, never expires)
 *        - one row per linked IG Business account (uses page token)
 *   6. Bounce the user back to the dashboard with a success flash.
 *
 * If the user denies on the FB dialog, FB redirects with
 * `?error=access_denied` instead of `code`. We bounce them back with
 * an error flash; no row written.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const env = serverEnv();
  const pub = publicEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json({ error: 'meta_not_configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateFromQuery = url.searchParams.get('state');
  const fbError = url.searchParams.get('error');
  const fbErrorReason = url.searchParams.get('error_reason');

  // Recover the returnTo target from the signed cookie so we can
  // bounce the user back even on errors.
  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? '';
  const verified = stateFromQuery
    ? await verifyState({
        secret: env.AHO_TOKEN_ENCRYPTION_KEY,
        cookieValue: cookie,
        state: stateFromQuery,
      })
    : null;
  const returnTo = verified?.returnTo ?? '/en/dashboard/social';

  function bounce(qs: string): NextResponse {
    const target = new URL(`${pub.NEXT_PUBLIC_SITE_URL}${returnTo}`);
    for (const [k, v] of new URLSearchParams(qs)) target.searchParams.set(k, v);
    const res = NextResponse.redirect(target.toString(), { status: 302 });
    // Clear the state cookie either way — it's single-use.
    res.cookies.set({
      name: STATE_COOKIE,
      value: '',
      path: '/',
      maxAge: 0,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
    });
    return res;
  }

  if (fbError) {
    return bounce(`meta_oauth=denied&reason=${encodeURIComponent(fbErrorReason ?? fbError)}`);
  }
  if (!code || !stateFromQuery) {
    return bounce('meta_oauth=invalid');
  }
  if (!verified) {
    return bounce('meta_oauth=state_mismatch');
  }

  const redirectUri = `${pub.NEXT_PUBLIC_SITE_URL}/api/oauth/meta/callback`;

  // 2. Short-lived user token from the auth code.
  let shortToken;
  try {
    shortToken = await exchangeCode({
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      redirectUri,
      code,
    });
  } catch (e) {
    console.error('[meta/callback] exchangeCode', e);
    return bounce('meta_oauth=exchange_failed');
  }

  // 3. Long-lived user token (~60d).
  let longToken;
  try {
    longToken = await exchangeForLongLived({
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      shortToken: shortToken.access_token,
    });
  } catch (e) {
    console.error('[meta/callback] exchangeForLongLived', e);
    return bounce('meta_oauth=long_lived_failed');
  }

  // 4. User profile + managed pages.
  let me;
  let pages;
  try {
    me = await fetchMe(longToken.access_token);
    pages = await fetchPages(longToken.access_token);
  } catch (e) {
    console.error('[meta/callback] fetch user/pages', e);
    return bounce('meta_oauth=fetch_failed');
  }

  // 5. Encrypted upsert via the SECURITY DEFINER RPC. Admin client
  // because the user-context client doesn't have execute on the RPC.
  const admin = createAdminClient();
  const expiresAt =
    longToken.expires_in != null
      ? new Date(Date.now() + longToken.expires_in * 1000).toISOString()
      : null;

  const ipFromHeader =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = req.headers.get('user-agent') ?? null;

  // 5a. The long-lived USER token, keyed on the FB user id. Used for
  // listing pages later if the user adds a new Page after the initial
  // connection.
  await admin.rpc('upsert_platform_token', {
    p_user_id: userId,
    p_platform: 'meta',
    p_external_account_id: me.id,
    p_display_name: me.name,
    p_access_token: longToken.access_token,
    p_refresh_token: null,
    p_expires_at: expiresAt,
    p_scopes: [...META_SCOPES],
    p_user_agent: userAgent,
    p_ip_address: ipFromHeader,
    p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
  });

  // 5b. One row per managed FB Page. Page tokens DON'T expire (per
  // FB docs) so we leave expires_at null. external_account_id = page id.
  for (const page of pages) {
    await admin.rpc('upsert_platform_token', {
      p_user_id: userId,
      p_platform: 'meta',
      p_external_account_id: `page:${page.id}`,
      p_display_name: page.name + (page.category ? ` (${page.category})` : ''),
      p_access_token: page.access_token,
      p_refresh_token: null,
      p_expires_at: null,
      p_scopes: ['pages_manage_posts', 'pages_read_engagement'],
      p_user_agent: userAgent,
      p_ip_address: ipFromHeader,
      p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
    });

    // 5c. If the page has a linked IG Business account, store a
    // pointer row. The publish API uses the page token to publish on
    // IG, so we re-store the same access_token under the IG external id.
    if (page.instagram_business_account?.id) {
      await admin.rpc('upsert_platform_token', {
        p_user_id: userId,
        p_platform: 'meta',
        p_external_account_id: `ig:${page.instagram_business_account.id}`,
        p_display_name: `Instagram (${page.name})`,
        p_access_token: page.access_token,
        p_refresh_token: null,
        p_expires_at: null,
        p_scopes: ['instagram_basic', 'instagram_content_publish'],
        p_user_agent: userAgent,
        p_ip_address: ipFromHeader,
        p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
      });
    }
  }

  return bounce(
    `meta_oauth=connected&pages=${pages.length}&ig=${pages.filter((p) => p.instagram_business_account?.id).length}`,
  );
}
