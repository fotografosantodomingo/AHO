import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv, serverEnv } from '@/lib/env';
import { buildAuthUrl, chooseScopes } from '@/lib/oauth/linkedin';
import { buildState, STATE_COOKIE } from '@/lib/oauth/state';

export const runtime = 'edge';

/**
 * GET /api/oauth/linkedin/start
 *
 * Mirrors /api/oauth/meta/start. Initiates the LinkedIn OAuth flow for
 * the signed-in user, generates a CSRF state, signs it into a short-lived
 * cookie, and 302s to LinkedIn's authorization dialog with the
 * openid + profile + email + w_member_social scope set.
 *
 * Optional `?returnTo=` controls where the callback bounces the user
 * after success. Stripped of any host (open-redirect guard).
 *
 * Auth required: anon callers get 401 — connection happens on behalf
 * of an AHO user; we don't store tokens for someone we don't know.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const env = serverEnv();
  const pub = publicEnv();
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET) {
    return NextResponse.json(
      { error: 'linkedin_not_configured' },
      { status: 503 },
    );
  }
  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: 'token_key_not_configured' },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const rawReturnTo = url.searchParams.get('returnTo') ?? '';
  const returnTo =
    rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : '/en/dashboard/social';

  const redirectUri = `${pub.NEXT_PUBLIC_SITE_URL}/api/oauth/linkedin/callback`;
  const { state, cookieValue, cookieMaxAgeSeconds } = await buildState({
    secret: env.AHO_TOKEN_ENCRYPTION_KEY,
    returnTo,
  });

  // Scope set is conditional: identity-only by default, identity+publish
  // once env LINKEDIN_PUBLISH_ENABLED='true' (paired with the dev app's
  // Share-on-LinkedIn product reaching Verified). LinkedIn rejects the
  // entire flow if any requested scope isn't approved on the app, so we
  // can't optimistically request and degrade.
  const publishEnabled = env.LINKEDIN_PUBLISH_ENABLED === 'true';
  const authUrl = buildAuthUrl({
    clientId: env.LINKEDIN_CLIENT_ID,
    redirectUri,
    state,
    scopes: chooseScopes(publishEnabled),
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
