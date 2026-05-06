import { type NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/brevo';
import { renderWelcomeEmail } from '@/lib/email/templates/welcome';
import { renderAdminNewUserEmail } from '@/lib/email/templates/admin-new-user';
import { publicEnv } from '@/lib/env';
import { LOCALES, type Locale } from '@/i18n/config';
import { ANON_COOKIE_NAME } from '@/lib/listings/recent-views';

export const runtime = 'edge';

/**
 * GET /auth/callback
 *
 * Single endpoint for Supabase Auth redirects:
 *   - **OAuth / magic-link** flows arrive with `?code=...` — exchange for a session.
 *   - **Email confirmation / password recovery** flows arrive with
 *     `?token_hash=...&type=signup|recovery|...` — verify the OTP.
 *
 * On `type=signup` confirmations we fire a welcome email via Brevo. The
 * email is best-effort (no-op if BREVO_API_KEY is unset) and runs
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
    // PKCE flow: the browser that started signin stored a `code_verifier`
    // in a Supabase cookie; the exchange MUST happen in the same browser.
    // The most common failure: user clicked the magic-link / OAuth redirect
    // on a different device than the one they started signin on. Surface
    // that with a specific error code so /auth/error can explain.
    //
    // Our createServerSupabaseClient awaits `cookies()` before this call
    // (per the @supabase/ssr Next.js 14+ recipe), so the verifier IS read
    // when present. The error is genuinely "wrong browser" when it fires.
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const reason = /pkce|code[\s_-]?verifier/i.test(error.message)
        ? 'pkce_browser_mismatch'
        : error.message;
      return errorRedirect(reason);
    }
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

  // Merge anonymous-view history into the now-authenticated user's
  // history. If the visitor had been browsing as anon and looked at a
  // few properties, the `aho_anon_id` cookie holds those views; without
  // this step the user signs in and the "Recently viewed" rail goes
  // empty. See migration 0030 for conflict-handling semantics. Best-
  // effort: failures log but never block the redirect.
  try {
    const anonId = request.cookies.get(ANON_COOKIE_NAME)?.value;
    if (anonId) {
      const { data: userResult } = await supabase.auth.getUser();
      if (userResult.user?.id) {
        await supabase.rpc('merge_anon_recent_views', {
          p_user_id: userResult.user.id,
          p_anonymous_id: anonId,
        });
      }
    }
  } catch (e) {
    console.warn('[auth/callback] merge_anon_recent_views failed', e);
  }

  // On signup confirmation, fire two emails in parallel:
  //   - Welcome to the user
  //   - Admin notification to ADMIN_EMAIL (info@advertisehomes.online)
  // Both are best-effort: a failure logs but does not block the redirect.
  // The send is fast (single fetch to Brevo) so we await before redirecting
  // for predictable observability — not on a hot path.
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
        const adminUsersUrl = `${pub.NEXT_PUBLIC_SITE_URL}/${inferredLocale}/admin/users`;

        const welcome = renderWelcomeEmail({
          email: user.email,
          locale: inferredLocale,
          homeUrl,
          pricingUrl,
        });
        const sends: Array<Promise<unknown>> = [
          sendEmail({ to: user.email, subject: welcome.subject, html: welcome.html }),
        ];

        const adminEmail = process.env.ADMIN_EMAIL;
        if (adminEmail) {
          const meta = (user.user_metadata ?? {}) as {
            marketing_opt_in?: boolean;
            locale?: string;
          };
          const adminNotice = renderAdminNewUserEmail({
            userEmail: user.email,
            locale: inferredLocale,
            marketingOptIn: meta.marketing_opt_in === true,
            signedUpAt: new Date().toISOString(),
            adminUsersUrl,
          });
          sends.push(
            sendEmail({
              to: adminEmail,
              subject: adminNotice.subject,
              html: adminNotice.html,
            }),
          );
        } else {
          console.warn(
            '[auth/callback] ADMIN_EMAIL not set; skipping admin new-user notice',
          );
        }

        await Promise.allSettled(sends);
      }
    } catch (e) {
      console.error('[auth/callback] post-confirmation emails failed', e);
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
