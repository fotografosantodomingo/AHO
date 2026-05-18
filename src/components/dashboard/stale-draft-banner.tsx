'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  pendingCount: number;
  inboxHref: string;
}

/**
 * Amber banner shown at the top of every dashboard page when the
 * agent has 3+ pending AI drafts AND the oldest is at least 24 hours
 * old. Phase 4 of `docs/AI_CONVERSION_PLAN.md`.
 *
 * The decision of "should this banner render" is made server-side in
 * `dashboard/layout.tsx` (this component is only mounted when the
 * count + freshness gates have already passed). The client-side state
 * here is solely the **per-session dismiss** — once the agent clicks
 * the x they shouldn't see the banner again until they reload / open
 * a fresh tab. sessionStorage scopes the dismiss to the tab so opening
 * a new tab tomorrow surfaces the nudge again (the whole point is to
 * pull them back into the inbox; a permanent dismiss would defeat
 * that).
 *
 * Why not localStorage: a permanent dismiss is hostile UX for a
 * back-pressure nudge — the agent's drafts pile up the longer they
 * wait, so re-showing the nudge on the next dashboard visit is the
 * desired behavior.
 */
export function StaleDraftBanner({ pendingCount, inboxHref }: Props) {
  const t = useTranslations('dashboard.staleDraftBanner');
  const [dismissed, setDismissed] = useState(false);

  // Read the per-session dismiss flag on mount. SSR returns the
  // banner; the effect can hide it instantly if the user already
  // dismissed it this session.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem('aho:stale-draft-banner:dismissed') === '1') {
        setDismissed(true);
      }
    } catch {
      // sessionStorage can throw in private browsing; in that case
      // we show the banner every navigation (safe default).
    }
  }, []);

  if (dismissed) return null;

  function onDismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem('aho:stale-draft-banner:dismissed', '1');
    } catch {
      // Same private-browsing caveat as above; the in-memory state
      // still suppresses the banner for the rest of this render.
    }
  }

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <span aria-hidden="true" className="mt-0.5 text-base leading-none">
        !
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t('message', { count: pendingCount })}</p>
        <a
          href={inboxHref}
          className="mt-1 inline-block font-semibold underline underline-offset-2 hover:no-underline"
        >
          {t('cta')}
        </a>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('dismiss')}
        className="-mr-1 ml-1 shrink-0 rounded-md p-1 leading-none text-amber-700 transition hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
