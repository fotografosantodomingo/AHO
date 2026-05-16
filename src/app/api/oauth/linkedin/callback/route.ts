import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv, serverEnv } from '@/lib/env';
import {
  chooseScopes,
  exchangeCode,
  fetchUserInfo,
} from '@/lib/oauth/linkedin';
import { verifyState, STATE_COOKIE } from '@/lib/oauth/state';

export const runtime = 'edge';

/**
 * GET /api/oauth/linkedin/callback
 *
 * Step 3 of the OAuth flow:
 *   1. Verify the signed state cookie matches `state` query param (CSRF).
 *   2. Exchange the code for an access_token (~60d) + OIDC id_token.
 *   3. Fetch /v2/userinfo for the member URN suffix + display name + email.
 *   4. Encrypted-upsert one row into `ad_platform_tokens` keyed on
 *      (user_id, 'linkedin', sub). external_account_id = the LinkedIn
 *      member id; the publish primitive will compose the URN at call time.
 *   5. Bounce the user back to the dashboard with a success flash.
 *
 * If the user denies on the LinkedIn dialog, LinkedIn redirects with
 * `?error=user_cancelled_login` instead of `code`. We bounce them back
 * with an error flash; no row written.
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
  if (
    !env.LINKEDIN_CLIENT_ID ||
    !env.LINKEDIN_CLIENT_SECRET ||
    !env.AHO_TOKEN_ENCRYPTION_KEY
  ) {
    return NextResponse.json(
      { error: 'linkedin_not_configured' },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const stateFromQuery = url.searchParams.get('state');
  const liError = url.searchParams.get('error');
  const liErrorDescription = url.searchParams.get('error_description');

  // Recover returnTo from the signed cookie so we can bounce on errors too.
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

  if (liError) {
    // Disambiguate the broad "denied" bucket. LinkedIn surfaces the real
    // root cause via error_description; we map the common categories so the
    // UI can render an actionable message instead of "you declined" for
    // every failure mode.
    const desc = (liErrorDescription ?? '').toLowerCase();
    let status = 'denied';
    if (liError === 'user_cancelled_login' || liError === 'user_cancelled_authorize') {
      status = 'denied';
    } else if (desc.includes('not authorized for your application') || desc.includes('scope')) {
      status = 'scope_not_authorized';
    } else if (liError === 'unauthorized_client' || liError === 'invalid_client') {
      status = 'invalid_client';
    } else if (liError === 'access_denied') {
      status = 'denied';
    }
    return bounce(
      `linkedin_oauth=${status}&reason=${encodeURIComponent(liErrorDescription ?? liError)}`,
    );
  }
  if (!code || !stateFromQuery) {
    return bounce('linkedin_oauth=invalid');
  }
  if (!verified) {
    return bounce('linkedin_oauth=state_mismatch');
  }

  const redirectUri = `${pub.NEXT_PUBLIC_SITE_URL}/api/oauth/linkedin/callback`;

  // 2. Token exchange.
  let token;
  try {
    token = await exchangeCode({
      clientId: env.LINKEDIN_CLIENT_ID,
      clientSecret: env.LINKEDIN_CLIENT_SECRET,
      redirectUri,
      code,
    });
  } catch (e) {
    console.error('[linkedin/callback] exchangeCode', e);
    return bounce('linkedin_oauth=exchange_failed');
  }

  // 3. Member profile claims.
  let me;
  try {
    me = await fetchUserInfo(token.access_token);
  } catch (e) {
    console.error('[linkedin/callback] fetchUserInfo', e);
    return bounce('linkedin_oauth=fetch_failed');
  }

  // 4. Encrypted upsert. Admin client because user-context client doesn't
  // hold execute on the SECURITY DEFINER RPC.
  const admin = createAdminClient();
  const expiresAt = new Date(
    Date.now() + token.expires_in * 1000,
  ).toISOString();

  const ipFromHeader =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const userAgent = req.headers.get('user-agent') ?? null;

  await admin.rpc('upsert_platform_token', {
    p_user_id: userId,
    p_platform: 'linkedin',
    p_external_account_id: me.sub,
    p_display_name: me.name,
    p_access_token: token.access_token,
    p_refresh_token: token.refresh_token ?? null,
    p_expires_at: expiresAt,
    // Record the scopes we ASKED for (not what LinkedIn returned — they
    // grant exactly the requested set or fail the whole flow). Mirrors
    // the chooseScopes() decision in /api/oauth/linkedin/start.
    p_scopes: [...chooseScopes(env.LINKEDIN_PUBLISH_ENABLED === 'true')],
    p_user_agent: userAgent,
    p_ip_address: ipFromHeader,
    p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
  });

  return bounce(`linkedin_oauth=connected&name=${encodeURIComponent(me.name)}`);
}
