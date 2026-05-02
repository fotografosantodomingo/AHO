'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { LOCALES, type Locale } from '@/i18n/config';
import { usePathname, getPathname } from '@/i18n/routing';

const PROPERTY_PATH_SEGMENTS = new Set(['properties', 'propiedades']);
const PROPERTY_PATH_FOR_LOCALE: Record<Locale, string> = {
  en: 'properties',
  es: 'propiedades',
};

/**
 * Locale switcher (no globe icon — clean dropdown only).
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
 * Property pages (`/properties/[slug]-[shortId]`) are special: the slug
 * portion is locale-specific (`slug_en` vs `slug_es`). When switching
 * locales, we preserve the immutable shortId and let the destination
 * page redirect to its canonical slug for the target locale. Single-
 * language listings (the other-locale slug is null) skip the redirect
 * and render the source content under "Translation pending" UX.
 *
 * Path translations for everything else (e.g. /dashboard ↔ /panel) are
 * handled by `getPathname({ href, locale })` from next-intl/routing.
 * Final safety net: any unrecoverable resolution falls back to the
 * locale home rather than throwing.
 */
interface Props {
  /** 'header' (default) — cream surface, warm-tan border, forest chevron.
   *  'footer' — transparent on the forest band, cream border + chevron. */
  variant?: 'header' | 'footer';
}

export function LocaleToggle({ variant = 'header' }: Props = {}) {
  const t = useTranslations('locale');
  const locale = useLocale();
  const pathname = usePathname();
  const [isPending, setIsPending] = useState(false);

  function switchTo(next: Locale) {
    if (next === locale) return;
    setIsPending(true);

    // Read the REAL browser URL (resolved, with locale prefix) instead
    // of next-intl's usePathname(). With `pathnames` config set, next-
    // intl's usePathname() returns the route TEMPLATE — for a request
    // to `/en/properties/abc-xyz123`, usePathname() returns
    // `/properties/[slug]` (literal brackets), which then propagates
    // through `getPathname({href})` and we end up navigating to
    // `/es/propiedades/[slug]`. Bug fixed 2026-05-02 after PO hit
    // "Internal Server Error" trying to switch locale on a property
    // page. The Client Component runs in the browser so reading
    // window.location is safe.
    const browserPath = window.location.pathname; // e.g. /en/properties/abc-xyz123
    const localePrefix = `/${locale}`;
    const localeless = browserPath.startsWith(localePrefix)
      ? browserPath.slice(localePrefix.length) || '/'
      : browserPath; // e.g. /properties/abc-xyz123

    // Property-page special case: preserve the {slug-shortId} tail and
    // swap the path segment. Destination page resolves canonical for
    // the target locale.
    const propertyMatch = localeless.match(/^\/(properties|propiedades)\/(.+)$/);
    const segment = propertyMatch?.[1];
    const slugAndShortId = propertyMatch?.[2];
    if (
      segment &&
      slugAndShortId &&
      PROPERTY_PATH_SEGMENTS.has(segment) &&
      /^.+-[0-9a-zA-Z]{6}$/.test(slugAndShortId)
    ) {
      window.location.assign(
        `/${next}/${PROPERTY_PATH_FOR_LOCALE[next]}/${slugAndShortId}`,
      );
      return;
    }

    // Default path: typed-route lookup uses the next-intl pathname
    // (which IS the typed-route template like `/dashboard` or
    // `/saved-searches`), since getPathname() expects a typed-route key.
    // Falls back to prefix-swap on the real browser URL, then to locale
    // home.
    let target: string | undefined;
    try {
      target = getPathname({
        // @ts-expect-error — typed routes for dynamic [slug] aren't always inferred
        href: pathname,
        locale: next,
      });
    } catch {
      target = undefined;
    }
    if (!target || typeof target !== 'string' || target.includes('[')) {
      // `[` check guards against templates leaking through (e.g.
      // `/propiedades/[slug]`); we'd rather land on the locale home
      // than navigate to a literal placeholder URL.
      target = `/${next}${localeless.startsWith('/') ? localeless : `/${localeless}`}`;
    }
    if (!target.startsWith(`/${next}`)) {
      target = `/${next}`;
    }
    if (target.includes('[')) {
      target = `/${next}`;
    }
    window.location.assign(target + window.location.search + window.location.hash);
  }

  // Variant styling. Header uses cream surface + warm-tan border + forest
  // chevron. Footer uses transparent on the forest band + cream border +
  // cream chevron — same widget, different chrome for the surface it sits on.
  const headerClass =
    'h-11 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface bg-[image:var(--chevron-down)] bg-[position:right_0.625rem_center] bg-[size:0.85em] bg-no-repeat py-0 pr-8 pl-4 text-sm font-medium tracking-tight transition-colors hover:border-action focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action/50 disabled:opacity-60 dark:bg-surface-deep dark:hover:border-action-dark dark:focus-visible:ring-action-dark/50';
  const footerClass =
    'h-9 cursor-pointer appearance-none rounded-full border border-white/20 bg-transparent bg-[image:var(--chevron-down)] bg-[position:right_0.5rem_center] bg-[size:0.7em] bg-no-repeat py-0 pr-7 pl-3 text-xs font-medium tracking-tight text-ink-inverse transition-colors hover:border-action-dark focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-action-dark/40 disabled:opacity-60';

  // Forest chevron for header (reads on cream); cream chevron for footer
  // (reads on dark forest).
  const headerChevron =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%231d5a3c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='1,1 6,6 11,1'/></svg>\")";
  const footerChevron =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8' fill='none' stroke='%23f4ede1' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='1,1 6,6 11,1'/></svg>\")";

  return (
    <label className="inline-flex items-center text-sm">
      <span className="sr-only">{t('label')}</span>
      <select
        value={locale}
        onChange={(e) => switchTo(e.target.value as Locale)}
        disabled={isPending}
        className={variant === 'footer' ? footerClass : headerClass}
        style={{
          ['--chevron-down' as string]:
            variant === 'footer' ? footerChevron : headerChevron,
        }}
      >
        {LOCALES.map((l) => (
          <option
            key={l}
            value={l}
            // Native option list inherits the OS color scheme — explicitly
            // sourcing from --color-surface / --color-ink so the dropdown
            // is readable on both modes regardless of where the toggle lives.
            style={{ color: 'var(--color-ink)', backgroundColor: 'var(--color-surface)' }}
          >
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
