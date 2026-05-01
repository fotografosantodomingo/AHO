'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Globe } from 'lucide-react';
import { LOCALES, type Locale } from '@/i18n/config';
import { usePathname, getPathname } from '@/i18n/routing';

/**
 * Locale switcher.
 *
 * Hard navigation (window.location.assign) instead of `router.replace`.
 * Reason: next-intl's typed router does a soft client-side nav that
 * piggy-backs on Next's App Router RSC fetch. Supabase auth cookies
 * travel with the fetch in principle, but the soft nav doesn't re-run
 * middleware cleanly on every Next.js / @supabase/ssr version
 * combination, and the user can land on the new locale's page with the
 * server seeing them as signed-out (auth.getUser() returns null even
 * though the cookies are still valid). A hard nav forces the browser to
 * issue a fresh request → middleware refreshes the session → the new
 * page sees them signed in.
 *
 * Path translations (e.g. /dashboard ↔ /panel) are handled by
 * `getPathname({ href, locale })` from next-intl/routing.
 */
export function LocaleToggle() {
  const t = useTranslations('locale');
  const locale = useLocale();
  const pathname = usePathname();
  const [isPending, setIsPending] = useState(false);

  function switchTo(next: Locale) {
    if (next === locale) return;
    setIsPending(true);
    // Resolve the localized URL, then hard-nav. getPathname returns the
    // /es/... or /en/... path with any path-translation applied.
    let target: string;
    try {
      target = getPathname({
        // @ts-expect-error — typed routes for dynamic [slug] aren't always inferred
        href: pathname,
        locale: next,
      });
    } catch {
      // Fallback: just swap the locale prefix if the typed lookup fails
      // (unknown route, e.g. an admin sub-page that isn't in PATHNAMES).
      target = `/${next}${pathname}`;
    }
    window.location.assign(target);
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">{t('label')}</span>
      <Globe aria-hidden="true" className="h-4 w-4" />
      <select
        value={locale}
        onChange={(e) => switchTo(e.target.value as Locale)}
        disabled={isPending}
        className="h-9 rounded-lg border border-border-strong bg-transparent px-2 text-sm"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
