'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Sign-out button.
 *
 * Two non-obvious choices:
 *   - `signOut({ scope: 'global' })` revokes ALL of the user's refresh tokens
 *     across every device (not just this browser tab). That matches the
 *     "log me out everywhere" expectation buyers have. Use scope='local'
 *     if we ever need a per-device sign-out.
 *   - `window.location.assign(...)` instead of `router.push(...)` because
 *     router.push does a soft nav that doesn't re-run middleware. The
 *     Supabase auth cookies are server-readable; soft navs hand the
 *     stale RSC tree back to the page and the user appears "still signed
 *     in" until they reload manually. Hard nav forces middleware to re-
 *     read cookies (now cleared) and the page re-renders signed-out.
 */
export function SignOutButton() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [isPending, setIsPending] = useState(false);

  async function onClick() {
    setIsPending(true);
    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut({ scope: 'global' });
    } catch (e) {
      // Failed to revoke at server — still clear local state and bounce.
      console.error('[signout] failed', e);
    }
    // Hard navigation to the locale home. Middleware re-runs with no
    // cookies → AuthMenu renders the signed-out branch.
    window.location.assign(`/${locale}`);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex h-9 items-center rounded-lg border border-border-strong/40 px-3 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
    >
      {isPending ? '…' : t('signOut')}
    </button>
  );
}
