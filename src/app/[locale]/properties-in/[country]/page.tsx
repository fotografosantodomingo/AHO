import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { getCountryCities } from '@/lib/listings/countries';
import { DotGrid } from '@/components/ui/dot-grid';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
  country: string;
}

function resolveCountryName(countryCode: string, locale: Locale): string {
  try {
    const display = new Intl.DisplayNames(
      [locale === 'es' ? 'es-DO' : 'en-US'],
      { type: 'region' },
    );
    return display.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, country } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const typedLocale = locale as Locale;
  const cc = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return {};

  const t = await getTranslations({ locale, namespace: 'countryLanding' });
  const display = resolveCountryName(cc, typedLocale);
  const title = t('headingTemplate', { country: display });
  const description = t('subheading', { country: display });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const enPath = `/en/properties-in/${cc.toLowerCase()}`;
  const esPath = `/es/inmuebles-en/${cc.toLowerCase()}`;

  return {
    title,
    description,
    alternates: {
      canonical: typedLocale === 'es' ? `${site}${esPath}` : `${site}${enPath}`,
      languages: {
        en: `${site}${enPath}`,
        es: `${site}${esPath}`,
        'x-default': `${site}${enPath}`,
      },
    },
    openGraph: {
      type: 'website',
      url: typedLocale === 'es' ? `${site}${esPath}` : `${site}${enPath}`,
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

/**
 * Country-level landing at `/{locale}/properties-in/{country}`. Lists every
 * city in the country with active listing counts, linking to the city
 * landing page below. Sits between the /countries directory and the
 * city-specific pages in the SEO geography hierarchy.
 *
 * 2-letter ISO code in the URL (lowercased). Intl.DisplayNames resolves
 * the localized country name. Empty (no listings in this country yet)
 * surfaces an honest empty state — same agent-acquisition CTA as the
 * city-landing page.
 */
export default async function CountryLandingPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, country } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const cc = country.toUpperCase();
  const display = resolveCountryName(cc, typedLocale);
  const t = await getTranslations({ locale, namespace: 'countryLanding' });

  const result = await getCountryCities(cc);

  const homePath = `/${locale}`;
  const countriesPath = `/${locale}/${typedLocale === 'es' ? 'paises' : 'countries'}`;
  const cityHref = (citySlug: string) =>
    `/${locale}/${typedLocale === 'es' ? 'inmuebles-en' : 'properties-in'}/${cc.toLowerCase()}/${citySlug}`;
  const browseHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}?country=${cc}`;
  const pricingHref = `/${locale}/${typedLocale === 'es' ? 'precios' : 'pricing'}`;

  return (
    <main>
      <section className="relative overflow-hidden border-b border-border dark:bg-surface-deep">
        <DotGrid />
        <div className="relative mx-auto max-w-6xl px-6 py-14 md:py-16">
          <nav
            aria-label="Breadcrumb"
            className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-helper"
          >
            <Link href={homePath} className="hover:text-action dark:hover:text-action-dark">
              AHO
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              href={countriesPath}
              className="hover:text-action dark:hover:text-action-dark"
            >
              {t('breadcrumbCountries')}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="font-medium text-ink dark:text-ink-inverse">{display}</span>
          </nav>
          <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
            {t('headingTemplate', { country: display })}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted">
            {t('subheading', { country: display })}
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-6 py-12">
        {result.cities.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong/60 bg-surface p-12 text-center shadow-whisper dark:bg-surface-deep">
            <h2 className="font-brand text-xl font-semibold">
              {t('emptyHeading', { country: display })}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-helper">
              {t('emptyBody', { country: display })}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link
                href={pricingHref}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
              >
                {t('emptyAgentCta')}
              </Link>
              <Link
                href={countriesPath}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t('browseCountriesCta')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {result.cities.length === 1
                ? t('citiesCount_one')
                : t('citiesCount_other', { count: result.cities.length })}
            </p>
            <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.cities.map((row) => (
                <li key={row.citySlug}>
                  <Link
                    href={cityHref(row.citySlug)}
                    className="group flex items-center justify-between gap-4 rounded-card border border-border bg-surface p-4 shadow-whisper transition hover:-translate-y-0.5 hover:border-border-strong/60 hover:shadow-lg dark:bg-surface-deep"
                  >
                    <div className="min-w-0">
                      <p className="font-brand text-base font-semibold tracking-tight">
                        {row.city}
                      </p>
                      <p className="mt-1 text-xs uppercase tracking-wider text-helper">
                        {display}
                      </p>
                    </div>
                    <p className="font-brand text-xl font-semibold tabular-nums">
                      {row.listingCount}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Link
                href={browseHref}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t('viewAllInCountry', { country: display })}
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
