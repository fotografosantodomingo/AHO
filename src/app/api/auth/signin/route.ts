import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  checkLockout,
  pruneAuthFailures,
  recordAuthFailure,
} from '@/lib/auth/lockout';
import {
  TRUSTED_DEVICE_COOKIE,
  OTP_TTL_MINUTES,
  generateOtpCode,
  sha256,
  getClientIp,
  getClientCountry,
  summarizeUserAgent,
} from '@/lib/auth/trusted-device';
import { sendEmail } from '@/lib/email/brevo';
import { renderDeviceVerificationEmail } from '@/lib/email/templates/device-verification';
import { getCountryName } from '@/lib/i18n/countries';
import { narrowContentLocale, type Locale, LOCALES } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/auth/signin
 *
 * Two-phase password sign-in. Replaces the visible Cloudflare Turnstile
 * with a per-device email OTP — Hostinger / Google style. PO directive
 * 2026-05-10: visible CAPTCHA out, "we noticed a sign-in from a new
 * device, here's a code" in. Visible Turnstile widget on the form is
 * gone; the widget still renders off-screen so a token still flows up
 * (Supabase's project-level captcha enforcement is unchanged), but the
 * user never sees a challenge unless Cloudflare flags them as risky.
 *
 * Phase 1 (this route):
 *   1. Body validation + progressive lockout (unchanged from the
 *      original implementation — see src/lib/auth/lockout.ts).
 *   2. supabase.auth.signInWithPassword(). Cookie-aware client so that
 *      on the trusted-device path the session is already wired by the
 *      time we return.
 *   3. Trust check:
 *        - Read the `aho-trusted-device` cookie, sha256 it.
 *        - Look up an unexpired row in auth_trusted_devices for this
 *          user_id + token_hash.
 *        - If the row exists AND its `last_ip` equals the current
 *          `cf-connecting-ip` → trusted. Bump last_seen_at and return
 *          200 ok with the session intact.
 *        - Anything else (no cookie, cookie not in DB, IP changed) →
 *          untrusted: signOut() to clear the freshly-set session
 *          cookies, insert a row in auth_login_challenges, send the
 *          verification email, return 202 with { needsVerification,
 *          challengeId }. The browser then renders the OTP step.
 *
 * Phase 2 lives at /api/auth/verify-device.
 *
 * IP-change policy is the strict variant per PO directive: any change
 * vs the device row's last_ip triggers OTP. Comments in
 * `auth_trusted_devices.sql` flag the UX cost on mobile networks; can
 * be dialed down later.
 */

const SignInBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  /** Invisible Turnstile token. Still required by the Supabase project
   *  config; sourced from the off-screen widget on the form. */
  captchaToken: z.string().optional(),
  /** Locale of the form at submit time. Used to localize the country
   *  name in the verification email. Falls back to 'en'. */
  locale: z.string().optional(),
});

interface SignInErrorBody {
  error: string;
  message?: string;
  reason?: string;
  retryAfter?: string;
}

interface SignInSuccessBody {
  ok: true;
}

interface SignInChallengeBody {
  needsVerification: true;
  challengeId: string;
  /** Convenience for the UI — the email we just sent the code to,
   *  partially masked so we never echo a real address. */
  emailHint: string;
  /** Total minutes until expiry (display only). */
  expiresInMinutes: number;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = SignInBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json<SignInErrorBody>(
      { error: 'invalid_request' },
      { status: 400 },
    );
  }
  const { email, password, captchaToken } = parsed.data;
  const formLocale: Locale = LOCALES.includes(parsed.data.locale as Locale)
    ? (parsed.data.locale as Locale)
    : 'en';

  const remoteIp = getClientIp(req.headers);
  const country = getClientCountry(req.headers);
  const userAgent = req.headers.get('user-agent');

  // Lockout gate (unchanged).
  const lockout = await checkLockout(email);
  if (lockout.blocked) {
    await recordAuthFailure({ email, ip: remoteIp, userAgent });
    return NextResponse.json<SignInErrorBody>(
      {
        error: 'locked_out',
        reason: lockout.reason,
        retryAfter: lockout.retryAfter?.toISOString(),
      },
      {
        status: 429,
        headers: lockout.retryAfter
          ? {
              'retry-after': String(
                Math.max(
                  1,
                  Math.ceil((lockout.retryAfter.getTime() - Date.now()) / 1000),
                ),
              ),
            }
          : {},
      },
    );
  }

  // Validate credentials. Cookie-aware client → the session cookies
  // are set on the response immediately. We undo this with signOut()
  // below if the device turns out to be untrusted.
  const supabase = await createServerSupabaseClient();
  const { data: signInData, error } = await supabase.auth.signInWithPassword({
    email,
    password,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });

  if (error || !signInData.user) {
    await recordAuthFailure({ email, ip: remoteIp, userAgent });
    return NextResponse.json<SignInErrorBody>(
      { error: 'invalid_credentials', message: error?.message },
      { status: 401 },
    );
  }

  const userId = signInData.user.id;
  const admin = createAdminClient();

  // Trust check: cookie present, row exists, not expired, IP matches.
  // Anything missing → untrusted, fall through to OTP.
  let trusted = false;
  let trustedRowId: string | null = null;
  const cookieValue = req.cookies.get(TRUSTED_DEVICE_COOKIE)?.value ?? null;
  if (cookieValue) {
    const tokenHash = await sha256(cookieValue);
    const { data: device } = await admin
      .from('auth_trusted_devices')
      .select('id, last_ip, expires_at')
      .eq('user_id', userId)
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (device) {
      // Strict IP-match policy per PO directive 2026-05-10. A change
      // (mobile→wifi, NAT shift, VPN flip) requires re-OTP, but the
      // device row stays — we update last_ip on the verify side.
      if (device.last_ip === remoteIp) {
        trusted = true;
        trustedRowId = device.id as string;
      }
    }
  }

  if (trusted) {
    // Bump heartbeat so the dashboard "active devices" list later shows
    // recency. Best-effort; ignore failures.
    if (trustedRowId) {
      const { error: touchErr } = await admin
        .from('auth_trusted_devices')
        .update({
          last_seen_at: new Date().toISOString(),
          country_last_seen: country,
        })
        .eq('id', trustedRowId);
      if (touchErr) {
        console.error('[auth/signin] trusted-device heartbeat failed', {
          code: touchErr.code,
          message: touchErr.message,
          details: touchErr.details,
          hint: touchErr.hint,
        });
      }
    }
    await pruneAuthFailures(email);
    return NextResponse.json<SignInSuccessBody>({ ok: true }, { status: 200 });
  }

  // Untrusted device → unwind the session we just established, issue
  // an OTP challenge, return 202. The user re-claims a session by
  // posting the code to /api/auth/verify-device.
  await supabase.auth.signOut();

  const code = generateOtpCode();
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const { data: challengeRow, error: challengeErr } = await admin
    .from('auth_login_challenges')
    .insert({
      user_id: userId,
      code_hash: codeHash,
      ip: remoteIp,
      country,
      user_agent: userAgent,
      expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single();
  if (challengeErr || !challengeRow) {
    console.error('[POST /api/auth/signin] challenge insert failed', challengeErr);
    return NextResponse.json<SignInErrorBody>(
      { error: 'challenge_failed' },
      { status: 500 },
    );
  }

  // Email dispatch — failure logs but does not unwind the challenge
  // (the user can hit "resend" from the OTP screen). Locale comes
  // from the form (so we render PL → EN narrowed for body copy but
  // localized country name in the body too).
  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single();
  if (profile?.email) {
    const emailLocale = narrowContentLocale(formLocale);
    const countryName = country ? getCountryName(country, formLocale) : null;
    const { subject, html } = renderDeviceVerificationEmail({
      recipientName: (profile.full_name as string | null) ?? null,
      code,
      expiresInMinutes: OTP_TTL_MINUTES,
      deviceLabel: summarizeUserAgent(userAgent),
      ip: remoteIp,
      countryName,
      locale: emailLocale,
    });
    const sendResult = await sendEmail({
      to: profile.email as string,
      subject,
      html,
    });
    if (!sendResult.sent) {
      console.warn('[POST /api/auth/signin] verification email not sent', {
        userId,
        challengeId: challengeRow.id,
        error: sendResult.error,
      });
    }
  }

  // Note: failure log is NOT pruned here — the user hasn't completed
  // sign-in yet. Pruning happens in /api/auth/verify-device on the
  // successful code consumption.

  return NextResponse.json<SignInChallengeBody>(
    {
      needsVerification: true,
      challengeId: challengeRow.id as string,
      emailHint: maskEmail(email),
      expiresInMinutes: OTP_TTL_MINUTES,
    },
    { status: 202 },
  );
}

/** Mirror of the lib/admin/pii-mask format for one-off use here.
 *  We don't import to keep this route self-contained at edge runtime. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const head = local.slice(0, 1);
  const bullets = '•'.repeat(Math.max(2, Math.min(6, local.length - 1)));
  return `${head}${bullets}@${domain}`;
}
