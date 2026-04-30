import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import {
  citySlugToQuery,
  searchCityLanding,
  type SearchListing,
} from '@/lib/listings/search';
import { ListingCard } from '@/components/listings/listing-card';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
  country: string;
  city: string;
}

/**
 * City landing page — `/{locale}/properties-in/{country}/{city}` (en) and
 * `/{locale}/inmuebles-en/{country}/{city}` (es).
 *
 * SEO purpose (HANDOFF.md §16.7): /search is intentionally noindex because
 * faceted URLs cause infinite crawl loops. City landing pages are the
 * canonical, indexable browse path. Every (country, city) pair gets a
 * stable URL we're happy for Google to index.
 *
 * Country slug:    lowercase ISO-3166-1 alpha-2 (do, us, mx, …)
 * City slug:       hyphenated lowercase (santo-domingo, new-york, …)
 *
 * The page uses ILIKE for the city match so URL-slug → DB-row resolution
 * is case- and spelling-tolerant ("santo-domingo" matches "Santo Domingo"
 * AND "santo domingo" AND "SANTO DOMINGO"). Empty pages still 200 — we
 * don't 404 a city with no listings yet. The empty state serves as
 * an agent-acquisition CTA + a soft signal to crawlers that the URL is
 * a real surface (just empty for now).
 */

function resolveCountryName(countryCode: string, locale: Locale): string {
  // Intl.DisplayNames is available in V8 (Edge runtime). Returns a
  // localized country name from the ISO 2-letter code.
  try {
    const display = new Intl.DisplayNames([locale === 'es' ? 'es-DO' : 'en-US'], {
      type: 'region',
    });
    return display.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

function unslugifyCity(slug: string): string {
  // Title-case a slug for display: "santo-domingo" → "Santo Domingo".
  return citySlugToQuery(slug)
    .split(' ')
    .map((w) => (w.length > 0 ? (w[0] ?? '').toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, country, city } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};

  const typedLocale = locale as Locale;
  const t = await getTranslations({ locale, namespace: 'cityLanding' });
  const cityDisplay = unslugifyCity(city);
  const countryDisplay = resolveCountryName(country, typedLocale);
  const title = t('headingTemplate', { city: cityDisplay, country: countryDisplay });
  const description = t('subheading', { city: cityDisplay });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const enPath = `/en/properties-in/${country}/${city}`;
  const esPath = `/es/inmuebles-en/${country}/${city}`;
  const canonical = typedLocale === 'es' ? `${site}${esPath}` : `${site}${enPath}`;

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        en: `${site}${enPath}`,
        es: `${site}${esPath}`,
        'x-default': `${site}${enPath}`,
      },
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

export default async function CityLandingPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, country, city } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'cityLanding' });
  const cityDisplay = unslugifyCity(city);
  const countryDisplay = resolveCountryName(country, typedLocale);
  const heading = t('headingTemplate', { city: cityDisplay, country: countryDisplay });

  const result = await searchCityLanding({
    countryCode: country,
    citySlug: city,
    locale: typedLocale,
  });

  // Prefer the canonical city name from the DB row when it differs from
  // our title-cased slug guess (e.g., DB has "Santo Domingo Este" but URL
  // is /santo-domingo-este → both display as "Santo Domingo Este").
  const canonicalCity = result.resolvedCity ?? cityDisplay;
  const canonicalCountry = countryDisplay;

  // JSON-LD ItemList for the listings on this page. Helps Google surface
  // city pages with a rich-result list of properties.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const jsonLd = buildItemListJsonLd({
    listings: result.listings,
    locale: typedLocale,
    siteOrigin: site,
    pageTitle: heading,
  });

  // "View all" CTA — when there are too many listings to show inline, send
  // crawlers + users to /search with the city filter pre-applied.
  const allListingsHref = `/${locale}/${
    typedLocale === 'es' ? 'buscar' : 'search'
  }?city=${encodeURIComponent(canonicalCity)}`;
  const browseAllHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}`;
  const pricingHref = `/${locale}/${typedLocale === 'es' ? 'precios' : 'pricing'}`;

  const homePath = `/${locale}`;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <main>
        {/* Hero band — dot-grid + soft action-color glow, same treatment as
            homepage and pricing. Breadcrumb sits above the H1 for easy
            wayfinding back up the geography hierarchy. */}
        <section className="relative overflow-hidden border-b border-border bg-surface-muted dark:bg-surface-deep">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.18]"
            style={{
              backgroundImage:
                'radial-gradient(rgb(97 104 117 / 0.35) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
              maskImage:
                'radial-gradient(ellipse 70% 50% at 50% 30%, #000 30%, transparent 75%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 70% 50% at 50% 30%, #000 30%, transparent 75%)',
            }}
          />
          <div className="relative mx-auto max-w-6xl px-6 py-14 md:py-16">
            <nav
              aria-label="Breadcrumb"
              className="mb-4 flex items-center gap-1.5 text-xs text-helper"
            >
              <Link href={homePath} className="hover:text-action dark:hover:text-action-dark">
                AHO
              </Link>
              <span aria-hidden="true">/</span>
              <span>{canonicalCountry}</span>
              <span aria-hidden="true">/</span>
              <span className="font-medium text-ink dark:text-ink-inverse">
                {canonicalCity}
              </span>
            </nav>
            <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
              {t('headingTemplate', { city: canonicalCity, country: canonicalCountry })}
            </h1>
            <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted">
              {t('subheading', { city: canonicalCity })}
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl space-y-8 px-6 py-12">
        {result.listings.length === 0 ? (
          <section className="rounded-card border border-dashed border-border-strong/60 p-12 text-center">
            <h2 className="font-brand text-xl font-bold">
              {t('emptyHeading', { city: canonicalCity })}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted dark:text-ink-inverse-muted">
              {t('emptyBody', { city: canonicalCity })}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link
                href={pricingHref}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
              >
                {t('emptyAgentCta')}
              </Link>
              <Link
                href={browseAllHref}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-surface-muted dark:hover:bg-surface-dark"
              >
                {t('browseAllCta')}
              </Link>
            </div>
          </section>
        ) : (
          <>
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {t(result.totalShown === 1 ? 'resultsCount_one' : 'resultsCount_other', {
                count: result.totalShown,
                city: canonicalCity,
              })}
            </p>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.listings.map((l) => (
                <li key={l.id}>
                  <ListingCard listing={l} locale={typedLocale} />
                </li>
              ))}
            </ul>
            {result.hasMore && (
              <div className="flex justify-center pt-4">
                <Link
                  href={allListingsHref}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-surface-muted dark:hover:bg-surface-dark"
                >
                  {t('viewAllCta')}
                </Link>
              </div>
            )}
          </>
        )}
        </div>
      </main>
    </>
  );
}

function buildItemListJsonLd({
  listings,
  locale,
  siteOrigin,
  pageTitle,
}: {
  listings: SearchListing[];
  locale: Locale;
  siteOrigin: string;
  pageTitle: string;
}) {
  const items = listings.map((l, idx) => {
    const slug = locale === 'es' ? l.slugEs ?? l.slugEn : l.slugEn ?? l.slugEs;
    const path = locale === 'es' ? 'propiedades' : 'properties';
    const url = slug ? `${siteOrigin}/${locale}/${path}/${slug}-${l.shortId}` : null;
    return {
      '@type': 'ListItem',
      position: idx + 1,
      url,
    };
  });
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: pageTitle,
    numberOfItems: listings.length,
    itemListElement: items,
  };
}
