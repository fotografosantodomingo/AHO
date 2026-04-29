import { type NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/resend';
import { renderWelcomeEmail } from '@/lib/email/templates/welcome';
import { publicEnv } from '@/lib/env';
import { LOCALES, type Locale } from '@/i18n/config';

/**
 * GET /auth/callback
 *
 * Single endpoint for Supabase Auth redirects:
 *   - **OAuth / magic-link** flows arrive with `?code=...` — exchange for a session.
 *   - **Email confirmation / password recovery** flows arrive with
 *     `?token_hash=...&type=signup|recovery|...` — verify the OTP.
 *
 * On `type=signup` confirmations we fire a welcome email via Resend. The
 * email is best-effort (no-op if RESEND_API_KEY is unset) and runs
 * post-redirect via fire-and-forget — failures don't block the user from
 * signing in.
 *
 * After session establishment, redirects to `?next=...` (or `/` if absent).
 *
 * This route is intentionally OUTSIDE the `[locale]` segment — Supabase Auth
 * doesn't know about our locale routing, and rewriting `/auth/callback` to
 * `/en/auth/callback` would 404. The next-intl middleware excludes
 * `/auth/callback` from its matcher (see `src/middleware.ts`).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const next = url.searchParams.get('next') ?? '/';

  const supabase = await createServerSupabaseClient();
  let isSignupConfirmation = false;

  // Pre-resolve the locale we'd use for any error redirect — ?next= encodes it.
  const errorLocale = inferLocaleFromPath(next);
  const errorRedirect = (reason: string) =>
    NextResponse.redirect(
      new URL(`/${errorLocale}/auth/error?reason=${encodeURIComponent(reason)}`, request.url),
    );

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return errorRedirect(error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) return errorRedirect(error.message);
    if (type === 'signup') {
      isSignupConfirmation = true;
    }
  } else {
    return errorRedirect('missing_code');
  }

  // Constrain `next` to internal paths to avoid open-redirect.
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  // Welcome-email fire-and-forget on signup confirmation. Wait for it before
  // redirecting so the response stays consistent with the actual write —
  // Resend send is fast (sub-second typically) and we're not on a hot path.
  if (isSignupConfirmation) {
    try {
      const { data: userResult } = await supabase.auth.getUser();
      const user = userResult.user;
      if (user?.email) {
        const inferredLocale = inferLocaleFromPath(safeNext);
        const pub = publicEnv();
        const homeUrl = `${pub.NEXT_PUBLIC_SITE_URL}/${inferredLocale}`;
        const pricingUrl = `${pub.NEXT_PUBLIC_SITE_URL}/${inferredLocale}/${
          inferredLocale === 'es' ? 'precios' : 'pricing'
        }`;
        const { subject, html } = renderWelcomeEmail({
          email: user.email,
          locale: inferredLocale,
          homeUrl,
          pricingUrl,
        });
        await sendEmail({ to: user.email, subject, html });
      }
    } catch (e) {
      console.error('[auth/callback] welcome email failed', e);
    }
  }

  return NextResponse.redirect(new URL(safeNext, request.url));
}

/**
 * Pick the locale to use for the welcome email's CTA URLs. We prefer the
 * locale embedded in the post-confirm `next` redirect (where the user is
 * about to land); fall back to `en`.
 */
function inferLocaleFromPath(path: string): Locale {
  const m = path.match(/^\/([a-z]{2})(?:\/|$)/);
  if (m && LOCALES.includes(m[1] as Locale)) return m[1] as Locale;
  return 'en';
}
