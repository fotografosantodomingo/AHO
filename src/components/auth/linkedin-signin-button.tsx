'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

interface Props {
  /** Where to land after successful LinkedIn sign-in. Defaults to the
   *  localized dashboard, mirroring the email-password + Google flows. */
  next?: string;
}

/**
 * "Continue with LinkedIn" button — calls Supabase Auth signInWithOAuth
 * with provider='linkedin_oidc' (the OpenID Connect variant; the older
 * 'linkedin' provider is deprecated by Supabase). Redirects to LinkedIn's
 * consent screen → /auth/callback?code=… → existing callback exchanges
 * the code for a session → user lands at `next`.
 *
 * Works for both sign-in and sign-up — Supabase auto-creates the
 * auth.users row on first login + the existing handle_new_auth_user
 * trigger (migration 0002) creates the matching profiles row.
 *
 * Provider config (one-time, done 2026-05-15):
 *   1. LinkedIn dev app at https://www.linkedin.com/developers/apps
 *      with "Sign In with LinkedIn using OpenID Connect" product approved
 *      and Company verification done.
 *   2. Supabase Auth provider enabled via Management API:
 *      external_linkedin_oidc_enabled=true + client_id + secret pushed.
 *
 * Note: this is the Supabase Auth side (sign-in only — gives us an
 * authenticated AHO user). Posting TO LinkedIn from inside the dashboard
 * uses our own OAuth flow at /api/oauth/linkedin/start which stores a
 * w_member_social token in ad_platform_tokens. The two are independent.
 */
export function LinkedInSignInButton({ next }: Props) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const dashPath = localePath(locale as Locale, '/dashboard');
    const redirectTarget =
      next ??
      `${window.location.origin}/auth/callback?next=${encodeURIComponent(dashPath)}`;
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'linkedin_oidc',
      options: {
        redirectTo: redirectTarget,
      },
    });
    if (signInError) {
      setError(signInError.message);
      setBusy(false);
    }
    // On success the browser navigates away; no need to setBusy(false).
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex h-10 w-full items-center justify-center gap-3 rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium text-ink shadow-whisper transition hover:bg-black/5 disabled:opacity-50 dark:bg-surface-deep dark:text-ink-inverse dark:hover:bg-white/5"
      >
        <LinkedInGlyph />
        {busy ? t('linkedinRedirecting') : t('linkedinContinue')}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Official LinkedIn "in" mark in SVG (white on LinkedIn-blue square). */
function LinkedInGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="24" height="24" rx="4" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M7.06 9.5h-2.6v8.5h2.6V9.5zm-1.3-3.7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM19.5 18h-2.6v-4.13c0-.99-.02-2.27-1.38-2.27-1.39 0-1.6 1.08-1.6 2.2V18h-2.6V9.5h2.5v1.16h.04c.35-.66 1.2-1.36 2.46-1.36 2.64 0 3.13 1.74 3.13 4v4.7z"
      />
    </svg>
  );
}
