import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';

interface Props {
  locale: Locale;
  /** Country ISO-3166-1 alpha-2 code (uppercase). Always present on
   *  country + city landing pages. */
  countryCode: string;
  /** Localized country display name. */
  countryDisplay: string;
  /** Optional city name. When set, the sub-bar shows City + a "back to
   *  country" affordance. */
  city?: string;
  /** Optional CTA label + href displayed at the right end. */
  cta?: { label: string; href: string };
}

/**
 * Contextual location navigation strip rendered on
 * /properties-in/[country] and /properties-in/[country]/[city] pages.
 *
 * Worldwide-shaped: the same component works for every country/city
 * combination. The labels swap by locale via existing i18n keys; no
 * country-specific branching.
 *
 * Visual: full-width band below the SiteHeader, lighter than the hero
 * section but more present than a breadcrumb. On mobile the items
 * wrap; on md+ they sit horizontally.
 */
export async function LocationSubBar({
  locale,
  countryCode,
  countryDisplay,
  city,
  cta,
}: Props) {
  const t = await getTranslations({ locale, namespace: 'locationSubBar' });

  const cc = countryCode.toLowerCase();
  const segment = locale === 'es' ? 'inmuebles-en' : 'properties-in';
  const countryHref = `/${locale}/${segment}/${cc}`;
  const allCountriesHref = `/${locale}/${locale === 'es' ? 'paises' : 'countries'}`;

  return (
    <nav
      aria-label={t('label')}
      className="border-b border-border bg-surface/50 dark:bg-surface-deep/50"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-2 text-xs text-helper">
        <Link href={allCountriesHref} className="hover:text-action dark:hover:text-action-dark">
          {t('allCountries')}
        </Link>
        <span aria-hidden="true">/</span>
        {city ? (
          <Link href={countryHref} className="hover:text-action dark:hover:text-action-dark">
            {countryDisplay}
          </Link>
        ) : (
          <span className="font-medium text-ink dark:text-ink-inverse">
            {countryDisplay}
          </span>
        )}
        {city && (
          <>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-ink dark:text-ink-inverse">{city}</span>
          </>
        )}
        {cta && (
          <Link
            href={cta.href}
            className="ml-auto inline-flex h-7 items-center rounded-md border border-border-strong px-2 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {cta.label}
          </Link>
        )}
      </div>
    </nav>
  );
}
