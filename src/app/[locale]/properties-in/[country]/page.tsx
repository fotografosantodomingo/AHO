import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getCountryCities } from '@/lib/listings/countries';
import { getCountryName } from '@/lib/i18n/countries';
import { DotGrid } from '@/components/ui/dot-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { LocationSubBar } from '@/components/location-sub-bar';
import { publicEnv } from '@/lib/env';
import {
  buildBreadcrumbList,
  buildItemList,
  buildPlace,
  serializeJsonLd,
} from '@/lib/seo/jsonld';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
  country: string;
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
  const display = getCountryName(cc, typedLocale);
  const title = t('headingTemplate', { country: display });
  const description = t('subheading', { country: display });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const safeCountry = cc.toLowerCase();
  const buildPath = (lc: Locale) => {
    const stem = localePath(lc, '/properties-in/[country]').replace('/[country]', '');
    return `${stem}/${safeCountry}`;
  };
  const languages: Record<string, string> = {};
  for (const lc of LOCALES) {
    languages[lc] = `${site}${buildPath(lc)}`;
  }
  languages['x-default'] = `${site}${buildPath('en')}`;
  const canonical = `${site}${buildPath(typedLocale)}`;

  return {
    title,
    description,
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      type: 'website',
      url: canonical,
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
  const display = getCountryName(cc, typedLocale);
  const t = await getTranslations({ locale, namespace: 'countryLanding' });

  const result = await getCountryCities(cc);

  const homePath = `/${locale}`;
  const countriesPath = localePath(typedLocale, '/countries');
  const cityStem = localePath(typedLocale, '/properties-in/[country]/[city]')
    .replace('/[country]/[city]', '');
  const cityHref = (citySlug: string) =>
    `${cityStem}/${cc.toLowerCase()}/${citySlug}`;
  const browseHref = `${localePath(typedLocale, '/search')}?country=${cc}`;
  const pricingHref = localePath(typedLocale, '/pricing');

  // JSON-LD nodes — Place (the country) + BreadcrumbList + ItemList of
  // its cities. Mirrors the shape used on the city landing one level
  // deeper. Cities with zero active listings still appear in result.cities
  // when the country has any listings; the ItemList is honest about
  // whatever's there. Empty country (no cities at all) emits a Place +
  // Breadcrumb but no ItemList — schema.org doesn't reject ItemList:0,
  // but skipping it avoids polluting GSC with "list with 0 items".
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const countryStem = localePath(typedLocale, '/properties-in/[country]').replace(
    '/[country]',
    '',
  );
  const countryUrl = `${site}${countryStem}/${cc.toLowerCase()}`;
  const placeLd = buildPlace({
    name: display,
    countryCode: cc,
    url: countryUrl,
    description: t('subheading', { country: display }),
  });
  const breadcrumbLd = buildBreadcrumbList([
    { name: 'AHO', url: `${site}/${locale}` },
    { name: t('breadcrumbCountries'), url: `${site}${countriesPath}` },
    { name: display, url: countryUrl },
  ]);
  const itemListLd =
    result.cities.length > 0
      ? buildItemList({
          name: t('headingTemplate', { country: display }),
          id: `${countryUrl}#cities`,
          entries: result.cities.map((row) => ({
            url: `${site}${cityHref(row.citySlug)}`,
            name: row.city,
          })),
        })
      : null;

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(placeLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbLd) }}
      />
      {itemListLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(itemListLd) }}
        />
      )}
      <LocationSubBar
        locale={typedLocale}
        countryCode={cc}
        countryDisplay={display}
      />
      <section className="relative overflow-hidden border-b border-border">
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
          <EmptyState
            heading={t('emptyHeading', { country: display })}
            body={t('emptyBody', { country: display })}
            primaryCta={
              <Link href={pricingHref} className="btn-primary">
                {t('emptyAgentCta')}
              </Link>
            }
            secondaryCta={
              <Link href={countriesPath} className="btn-secondary">
                {t('browseCountriesCta')}
              </Link>
            }
          />
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
