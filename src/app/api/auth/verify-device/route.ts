import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { pruneAuthFailures } from '@/lib/auth/lockout';
import {
  TRUSTED_DEVICE_COOKIE,
  TRUSTED_DEVICE_TTL_DAYS,
  OTP_MAX_ATTEMPTS,
  generateDeviceToken,
  sha256,
  trustedDeviceCookieOptions,
  getClientIp,
  getClientCountry,
  summarizeUserAgent,
} from '@/lib/auth/trusted-device';

export const runtime = 'edge';

/**
 * POST /api/auth/verify-device
 *
 * Phase 2 of the post-Turnstile sign-in. The browser arrives here
 * holding a `challengeId` from /api/auth/signin and the 6-digit code
 * the user typed in. We:
 *
 *   1. Look up the challenge (active, unexpired, attempts not maxed).
 *   2. sha256 the submitted code, constant-time compare to code_hash.
 *   3. On miss → bump attempts, return 400; on the 5th miss return 410
 *      and mark the challenge consumed so a fresh sign-in is required.
 *   4. On match → mark the challenge consumed, mint a real session via
 *      admin.generateLink(magiclink) → verifyOtp(token_hash) (Supabase
 *      sets cookies through the cookie-aware client), insert / refresh
 *      a row in auth_trusted_devices, set the trusted-device cookie
 *      with TRUSTED_DEVICE_TTL_DAYS Max-Age, return 200.
 *
 * This route is the ONLY public surface that can establish a session
 * for a sign-in that started untrusted, so it owes a careful read of
 * the challenge expiry + attempt cap. Everything else is a wrapper
 * around Supabase's own auth machinery.
 */

const VerifyBodySchema = z.object({
  challengeId: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

interface VerifyErrorBody {
  error: string;
  remainingAttempts?: number;
}
interface VerifySuccessBody {
  ok: true;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = VerifyBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json<VerifyErrorBody>(
      { error: 'invalid_request' },
      { status: 400 },
    );
  }
  const { challengeId, code } = parsed.data;

  const admin = createAdminClient();
  const { data: challenge, error: lookupErr } = await admin
    .from('auth_login_challenges')
    .select('id, user_id, code_hash, attempts, expires_at, consumed_at')
    .eq('id', challengeId)
    .maybeSingle();
  if (lookupErr || !challenge) {
    return NextResponse.json<VerifyErrorBody>(
      { error: 'challenge_not_found' },
      { status: 404 },
    );
  }
  if (challenge.consumed_at) {
    return NextResponse.json<VerifyErrorBody>(
      { error: 'challenge_already_used' },
      { status: 410 },
    );
  }
  if (new Date(challenge.expires_at as string).getTime() <= Date.now()) {
    return NextResponse.json<VerifyErrorBody>(
      { error: 'challenge_expired' },
      { status: 410 },
    );
  }
  if ((challenge.attempts as number) >= OTP_MAX_ATTEMPTS) {
    // Defensive — phase-2 attempts beyond the cap are also blocked,
    // even if a stale row sneaked past the prior bump.
    const { error: consumeErr } = await admin
      .from('auth_login_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challengeId);
    if (consumeErr) {
      console.error('[auth/verify-device] consume-on-cap failed', {
        code: consumeErr.code,
        message: consumeErr.message,
        details: consumeErr.details,
        hint: consumeErr.hint,
      });
    }
    return NextResponse.json<VerifyErrorBody>(
      { error: 'too_many_attempts' },
      { status: 410 },
    );
  }

  // Constant-time compare on the hex-bytea-literal hashes. Both sides
  // are strings shaped `\xHEX...` (PostgREST returns bytea reads in
  // that form, and we wrote with the same shape via sha256()).
  // Manual loop because Edge runtime doesn't expose timingSafeEqual.
  const submittedHash = await sha256(code);
  const storedHash = challenge.code_hash as unknown as string;

  if (!constantTimeEqual(submittedHash, storedHash)) {
    const newAttempts = (challenge.attempts as number) + 1;
    const remainingAttempts = OTP_MAX_ATTEMPTS - newAttempts;
    const { error: bumpErr } = await admin
      .from('auth_login_challenges')
      .update({
        attempts: newAttempts,
        ...(remainingAttempts <= 0
          ? { consumed_at: new Date().toISOString() }
          : {}),
      })
      .eq('id', challengeId);
    if (bumpErr) {
      console.error('[auth/verify-device] attempt-bump failed', {
        code: bumpErr.code,
        message: bumpErr.message,
        details: bumpErr.details,
        hint: bumpErr.hint,
      });
    }
    return NextResponse.json<VerifyErrorBody>(
      {
        error: remainingAttempts <= 0 ? 'too_many_attempts' : 'invalid_code',
        remainingAttempts: Math.max(0, remainingAttempts),
      },
      { status: remainingAttempts <= 0 ? 410 : 400 },
    );
  }

  // Code matched. Mark consumed before doing anything else so a
  // concurrent retry can't double-spend.
  const userId = challenge.user_id as string;
  const { error: matchConsumeErr } = await admin
    .from('auth_login_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challengeId);
  if (matchConsumeErr) {
    console.error('[auth/verify-device] consume-on-match failed', {
      code: matchConsumeErr.code,
      message: matchConsumeErr.message,
      details: matchConsumeErr.details,
      hint: matchConsumeErr.hint,
    });
  }

  // Resolve the user's email so we can mint a magic-link OTP. The
  // admin generateLink → verifyOtp dance turns the admin-issued token
  // into a real cookie session through supabase-js's normal
  // verification path.
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .single();
  if (profileErr || !profile?.email) {
    console.error('[POST /api/auth/verify-device] profile lookup failed', {
      userId,
      profileErr,
    });
    return NextResponse.json<VerifyErrorBody>(
      { error: 'session_mint_failed' },
      { status: 500 },
    );
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: profile.email as string,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error('[POST /api/auth/verify-device] generateLink failed', linkErr);
    return NextResponse.json<VerifyErrorBody>(
      { error: 'session_mint_failed' },
      { status: 500 },
    );
  }

  // Cookie-aware client. verifyOtp here will set the `sb-...-auth-token`
  // cookies on the response that the middleware + future requests read.
  const supabase = await createServerSupabaseClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr) {
    console.error('[POST /api/auth/verify-device] verifyOtp failed', verifyErr);
    return NextResponse.json<VerifyErrorBody>(
      { error: 'session_mint_failed' },
      { status: 500 },
    );
  }

  // Mint + persist the trusted-device record. The cookie value is the
  // raw token; the DB stores only sha256(token). On subsequent
  // /api/auth/signin calls the cookie hash is looked up to skip OTP.
  const remoteIp = getClientIp(req.headers);
  const country = getClientCountry(req.headers);
  const userAgent = req.headers.get('user-agent');
  const deviceLabel = summarizeUserAgent(userAgent);
  const deviceToken = generateDeviceToken();
  const deviceTokenHash = await sha256(deviceToken);
  const expiresAt = new Date(
    Date.now() + TRUSTED_DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const { error: deviceErr } = await admin.from('auth_trusted_devices').insert({
    user_id: userId,
    token_hash: deviceTokenHash,
    label: deviceLabel,
    ip_first_seen: remoteIp,
    last_ip: remoteIp,
    country_first_seen: country,
    country_last_seen: country,
    expires_at: expiresAt.toISOString(),
  });
  if (deviceErr) {
    // Don't fail the whole sign-in if device persistence broke — the
    // user is signed in; they'll just go through OTP again next time.
    console.warn('[POST /api/auth/verify-device] device row insert failed', {
      userId,
      error: deviceErr,
    });
  }

  await pruneAuthFailures(profile.email as string);

  // Set the trusted-device cookie. Secure flag follows the request
  // protocol so local-dev curls without TLS still get a cookie back.
  const isSecure = req.url.startsWith('https://');
  const res = NextResponse.json<VerifySuccessBody>({ ok: true }, { status: 200 });
  res.cookies.set(
    TRUSTED_DEVICE_COOKIE,
    deviceToken,
    trustedDeviceCookieOptions({ secure: isSecure }),
  );
  return res;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
