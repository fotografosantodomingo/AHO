import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { getCountriesIndex } from '@/lib/listings/countries';
import { DotGrid } from '@/components/ui/dot-grid';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: 'countries' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const enPath = '/en/countries';
  const esPath = '/es/paises';
  return {
    title: t('heading'),
    description: t('subheading'),
    alternates: {
      canonical: locale === 'es' ? `${site}${esPath}` : `${site}${enPath}`,
      languages: {
        en: `${site}${enPath}`,
        es: `${site}${esPath}`,
        'x-default': `${site}${enPath}`,
      },
    },
    openGraph: {
      type: 'website',
      url: locale === 'es' ? `${site}${esPath}` : `${site}${enPath}`,
      title: t('heading'),
      description: t('subheading'),
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Public countries directory at /{locale}/countries. Lists every country
 * that has active+published listings, grouped + sorted by listing count.
 *
 * Top-of-funnel browse path for visitors who don't have a specific city
 * in mind. Sits above the city landing pages in the SEO geography
 * hierarchy: /countries → /properties-in/{cc} → /properties-in/{cc}/{city}.
 *
 * Empty state (no countries with listings yet) is honest — no fake or
 * curated "popular countries" content per real-only-data rule.
 */
export default async function CountriesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'countries' });
  const rows = await getCountriesIndex(typedLocale);

  const countryHref = (cc: string) =>
    `/${locale}/${typedLocale === 'es' ? 'inmuebles-en' : 'properties-in'}/${cc.toLowerCase()}`;
  const browseHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}`;
  const pricingHref = `/${locale}/${typedLocale === 'es' ? 'precios' : 'pricing'}`;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-border dark:bg-surface-deep">
        <DotGrid />
        <div className="relative mx-auto max-w-5xl px-6 py-14 md:py-16">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('eyebrow')}
          </p>
          <h1 className="mt-2 font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
            {t('heading')}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted">
            {t('subheading')}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-12">
        {rows.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong/60 bg-surface-muted p-10 text-center dark:bg-surface-deep">
            <p className="font-brand text-base font-semibold">{t('emptyHeading')}</p>
            <p className="mx-auto mt-3 max-w-md text-sm text-helper">
              {t('emptyBody')}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link
                href={pricingHref}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
              >
                {t('emptyAgentCta')}
              </Link>
              <Link
                href={browseHref}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-surface-muted dark:hover:bg-surface-dark"
              >
                {t('browseAllCta')}
              </Link>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <li key={row.countryCode}>
                <Link
                  href={countryHref(row.countryCode)}
                  className="group flex items-center justify-between gap-4 rounded-card border border-border bg-surface p-4 shadow-whisper transition hover:-translate-y-0.5 hover:border-border-strong/60 hover:shadow-lg dark:bg-surface-deep"
                >
                  <div className="min-w-0">
                    <p className="font-brand text-base font-semibold tracking-tight">
                      {row.displayName}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wider text-helper">
                      {row.countryCode}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-brand text-2xl font-semibold">
                      {row.listingCount}
                    </p>
                    <p className="text-[11px] uppercase tracking-wider text-helper">
                      {row.listingCount === 1
                        ? t('listingsCount_one')
                        : t('listingsCount_other')}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
