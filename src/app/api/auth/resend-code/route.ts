import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  OTP_MAX_RESENDS,
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
 * POST /api/auth/resend-code
 *
 * Resend the OTP code for an active sign-in challenge. Capped at
 * OTP_MAX_RESENDS per challenge so a hostile actor can't fan out
 * Brevo sends to a victim's inbox by replaying the challengeId. Each
 * resend mints a fresh code (the old code becomes invalid because we
 * overwrite code_hash) and resets attempts to 0 so a user who
 * mis-typed three times gets a clean slate after re-sending.
 */

const ResendBodySchema = z.object({
  challengeId: z.string().uuid(),
  /** Locale for the email body. Falls back to 'en'. */
  locale: z.string().optional(),
});

interface ResendErrorBody {
  error: string;
}
interface ResendSuccessBody {
  ok: true;
  resendsRemaining: number;
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = ResendBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json<ResendErrorBody>(
      { error: 'invalid_request' },
      { status: 400 },
    );
  }
  const { challengeId } = parsed.data;
  const formLocale: Locale = LOCALES.includes(parsed.data.locale as Locale)
    ? (parsed.data.locale as Locale)
    : 'en';

  const admin = createAdminClient();
  const { data: challenge, error: lookupErr } = await admin
    .from('auth_login_challenges')
    .select(
      'id, user_id, expires_at, consumed_at, resend_count, last_resent_at',
    )
    .eq('id', challengeId)
    .maybeSingle();
  if (lookupErr || !challenge) {
    return NextResponse.json<ResendErrorBody>(
      { error: 'challenge_not_found' },
      { status: 404 },
    );
  }
  if (challenge.consumed_at) {
    return NextResponse.json<ResendErrorBody>(
      { error: 'challenge_already_used' },
      { status: 410 },
    );
  }
  if (new Date(challenge.expires_at as string).getTime() <= Date.now()) {
    return NextResponse.json<ResendErrorBody>(
      { error: 'challenge_expired' },
      { status: 410 },
    );
  }
  if ((challenge.resend_count as number) >= OTP_MAX_RESENDS) {
    return NextResponse.json<ResendErrorBody>(
      { error: 'resend_limit_reached' },
      { status: 429 },
    );
  }
  // Soft per-resend cooldown: 30s between sends. Keeps a single
  // misclick → re-click → re-click pattern from burning all 3 resends.
  const lastResentAt = challenge.last_resent_at as string | null;
  if (lastResentAt) {
    const sinceLast = Date.now() - new Date(lastResentAt).getTime();
    if (sinceLast < 30_000) {
      return NextResponse.json<ResendErrorBody>(
        { error: 'resend_cooldown' },
        {
          status: 429,
          headers: {
            'retry-after': String(Math.ceil((30_000 - sinceLast) / 1000)),
          },
        },
      );
    }
  }

  // Mint a fresh code, overwrite the prior code_hash, reset attempts
  // so the user gets a clean 5-try budget against the new code.
  const newCode = generateOtpCode();
  const newCodeHash = await sha256(newCode);
  const newResendCount = (challenge.resend_count as number) + 1;

  const { error: updErr } = await admin
    .from('auth_login_challenges')
    .update({
      code_hash: newCodeHash,
      attempts: 0,
      resend_count: newResendCount,
      last_resent_at: new Date().toISOString(),
    })
    .eq('id', challengeId);
  if (updErr) {
    console.error('[POST /api/auth/resend-code] update failed', updErr);
    return NextResponse.json<ResendErrorBody>(
      { error: 'resend_failed' },
      { status: 500 },
    );
  }

  // Re-derive the email context from current request headers (the
  // user could have switched networks between phase 1 and resend).
  const remoteIp = getClientIp(req.headers);
  const country = getClientCountry(req.headers);
  const userAgent = req.headers.get('user-agent');

  const { data: profile } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('id', challenge.user_id as string)
    .single();
  if (profile?.email) {
    const emailLocale = narrowContentLocale(formLocale);
    const countryName = country ? getCountryName(country, formLocale) : null;
    const { subject, html } = renderDeviceVerificationEmail({
      recipientName: (profile.full_name as string | null) ?? null,
      code: newCode,
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
      console.warn('[POST /api/auth/resend-code] email not sent', {
        challengeId,
        error: sendResult.error,
      });
    }
  }

  return NextResponse.json<ResendSuccessBody>(
    { ok: true, resendsRemaining: OTP_MAX_RESENDS - newResendCount },
    { status: 200 },
  );
}
