'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

interface Props {
  /** Where to land after successful Google sign-in. Defaults to the
   *  localized dashboard, mirroring the email-password flow. The
   *  dashboard layout itself bounces non-subscribers to /pricing,
   *  so subscribers land on their listings and free users hit the
   *  pricing page. */
  next?: string;
}

/**
 * "Continue with Google" button — calls Supabase Auth signInWithOAuth
 * with provider=google. The browser is redirected to Google's consent
 * screen → back to /auth/callback?code=... → existing callback
 * exchanges the code for a session → user lands at `next`.
 *
 * Works for both sign-in and sign-up because Google OAuth is unified
 * at the provider level — Supabase auto-creates the auth.users row
 * on first login + the existing `handle_new_auth_user` trigger
 * (migration 0002) creates the matching profiles row.
 *
 * PO config required to make this actually work (one-time):
 *   1. Google Cloud Console → APIs & Services → Credentials → create
 *      OAuth 2.0 Client ID (Web application).
 *      - Authorized JavaScript origins: https://advertisehomes.online
 *      - Authorized redirect URI:
 *        https://lqujtquofsdsxtujvjtl.supabase.co/auth/v1/callback
 *   2. Supabase Dashboard → Authentication → Providers → Google →
 *      enable + paste the Client ID + Client Secret from step 1.
 *
 * Until step 2 is done, clicking the button surfaces Supabase's
 * "Unsupported provider: provider is not enabled" error inline.
 */
export function GoogleSignInButton({ next }: Props) {
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
      provider: 'google',
      options: {
        redirectTo: redirectTarget,
        // Force the consent screen on every sign-in so the user can
        // pick their Google account if they have multiple — common
        // for agents who keep a personal + work Google account.
        queryParams: { prompt: 'select_account' },
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
        <GoogleGlyph />
        {busy ? t('googleRedirecting') : t('googleContinue')}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/** Official Google "G" mark in SVG (4 colors, simplified). */
function GoogleGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
