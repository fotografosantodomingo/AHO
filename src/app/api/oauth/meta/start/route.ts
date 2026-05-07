import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv, serverEnv } from '@/lib/env';
import { buildAuthUrl } from '@/lib/oauth/meta';
import { buildState, STATE_COOKIE } from '@/lib/oauth/state';

export const runtime = 'edge';

/**
 * GET /api/oauth/meta/start
 *
 * Initiates the Meta OAuth flow for the signed-in user. Generates a
 * CSRF state, signs it into a short-lived cookie, and 302s the user
 * to Facebook's authorization dialog with our requested scopes.
 *
 * Optional `?returnTo=` query param controls where the callback
 * bounces the user after success (defaults to /{locale}/dashboard/social).
 * The returnTo path is path-only — we strip any host to prevent
 * open-redirect attacks.
 *
 * Auth required: anon callers get 401. Connection happens on behalf
 * of an AHO user; we won't store tokens for someone we don't know.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const env = serverEnv();
  const pub = publicEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return NextResponse.json(
      { error: 'meta_not_configured' },
      { status: 503 },
    );
  }
  if (!env.META_LOGIN_CONFIG_ID) {
    // Required to drive the Login for Business permission set. Without
    // it Meta returns "Invalid Scopes" and falls back to public_profile
    // only — the connected user has no Page-publish capability.
    return NextResponse.json(
      { error: 'meta_config_id_missing' },
      { status: 503 },
    );
  }
  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    // Required as the HMAC secret for the state cookie. Same key the
    // RPCs use for token AES — independent crypto operation, safe.
    return NextResponse.json(
      { error: 'token_key_not_configured' },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const rawReturnTo = url.searchParams.get('returnTo') ?? '';
  // Open-redirect guard: only accept path-only return URLs (start with
  // `/` and don't contain a host). Reject `//evil.com/x` style paths.
  const returnTo =
    rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : '/en/dashboard/social';

  const redirectUri = `${pub.NEXT_PUBLIC_SITE_URL}/api/oauth/meta/callback`;
  const { state, cookieValue, cookieMaxAgeSeconds } = await buildState({
    secret: env.AHO_TOKEN_ENCRYPTION_KEY,
    returnTo,
  });

  const authUrl = buildAuthUrl({
    appId: env.META_APP_ID,
    redirectUri,
    state,
    configId: env.META_LOGIN_CONFIG_ID,
  });

  const res = NextResponse.redirect(authUrl, { status: 302 });
  res.cookies.set({
    name: STATE_COOKIE,
    value: cookieValue,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: cookieMaxAgeSeconds,
  });
  return res;
}
