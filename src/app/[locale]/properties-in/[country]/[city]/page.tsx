import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import {
  citySlugToQuery,
  searchCityLanding,
} from '@/lib/listings/search';
import { ListingCard } from '@/components/listings/listing-card';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { LocationSubBar } from '@/components/location-sub-bar';
import { DotGrid } from '@/components/ui/dot-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { publicEnv } from '@/lib/env';
import { getCountryName } from '@/lib/i18n/countries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserFavoriteIds } from '@/lib/listings/favorites';
import {
  buildBreadcrumbList,
  buildGraph,
  buildItemList,
  buildPlace,
} from '@/lib/seo/jsonld';
import { JsonLd } from '@/components/seo/JsonLd';

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
  const countryDisplay = getCountryName(country, typedLocale);
  const title = t('headingTemplate', { city: cityDisplay, country: countryDisplay });
  const description = t('subheading', { city: cityDisplay });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  // Normalise the country slug to lowercase so the canonical doesn't
  // split SERP authority with the lowercase form emitted by the sitemap
  // when a visitor hits e.g. /en/properties-in/DO/santo-domingo (#29).
  const safeCountry = country.toLowerCase();
  const buildPath = (lc: Locale) => {
    // ES has its own hand-translated segment; the v1 marketing locales
    // share EN segments per PATHNAMES.
    const stem = lc === 'es' ? 'inmuebles-en' : 'properties-in';
    return `/${lc}/${stem}/${safeCountry}/${city}`;
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
  const countryDisplay = getCountryName(country, typedLocale);
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

  // Precompute approx-converted price labels for the visible listings.
  const approxLabels = await precomputeApproxLabels(
    result.listings.map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      currency: l.currency,
    })),
    typedLocale,
  );

  // Favorites: pre-resolve per-listing heart state for the buyer.
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const favoriteIds = await getUserFavoriteIds(
    supabase,
    userId,
    result.listings.map((l) => l.id),
  );

  // "View all" CTA — when there are too many listings to show inline, send
  // crawlers + users to /search with the city filter pre-applied.
  const searchHref = localePath(typedLocale, '/search');
  const allListingsHref = `${searchHref}?city=${encodeURIComponent(canonicalCity)}`;
  const browseAllHref = searchHref;
  const pricingHref = localePath(typedLocale, '/pricing');

  const homePath = `/${locale}`;

  // JSON-LD: three nodes for this surface.
  //   1. Place — the city itself, with addressLocality + addressCountry
  //      so Google can attach the page to its geo entity.
  //   2. BreadcrumbList — Home > Country > City. Lets the SERP crumb
  //      trail render the localized country/city names.
  //   3. ItemList — the listings shown on the page. Filtered to entries
  //      with a resolvable detail URL (slug present in either locale).
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const cityStem = localePath(typedLocale, '/properties-in/[country]/[city]')
    .replace('/[country]/[city]', '');
  const countryStem = localePath(typedLocale, '/properties-in/[country]').replace(
    '/[country]',
    '',
  );
  const cityPageUrl = `${site}${cityStem}/${country}/${city}`;
  const countryPageUrl = `${site}${countryStem}/${country}`;
  const subheading = t('subheading', { city: canonicalCity });

  const placeLd = buildPlace({
    name: `${canonicalCity}, ${canonicalCountry}`,
    city: canonicalCity,
    countryCode: country.toUpperCase(),
    url: cityPageUrl,
    description: subheading,
  });
  const breadcrumbLd = buildBreadcrumbList([
    { name: 'AHO', url: `${site}/${locale}` },
    { name: canonicalCountry, url: countryPageUrl },
    { name: canonicalCity, url: cityPageUrl },
  ]);
  const itemListLd = buildItemList({
    name: heading,
    id: `${cityPageUrl}#listings`,
    entries: (() => {
      const propertyStem = localePath(typedLocale, '/properties/[slug]').replace(
        '/[slug]',
        '',
      );
      return result.listings.map((l) => {
        const slug = typedLocale === 'es' ? l.slugEs ?? l.slugEn : l.slugEn ?? l.slugEs;
        if (!slug) return null;
        return {
          url: `${site}${propertyStem}/${slug}-${l.shortId}`,
          name: (typedLocale === 'es' ? l.titleEs : l.titleEn) ?? l.titleEn ?? l.titleEs ?? undefined,
        };
      });
    })(),
  });

  // Single @graph: Place + BreadcrumbList + ItemList (listings).
  const pageGraph = buildGraph([placeLd, breadcrumbLd, itemListLd]);

  return (
    <>
      <JsonLd node={pageGraph} />
      <main>
        <LocationSubBar
          locale={typedLocale}
          countryCode={country}
          countryDisplay={canonicalCountry}
          city={canonicalCity}
        />
        {/* Hero band — dot-grid pattern, breadcrumb above H1. */}
        <section className="relative overflow-hidden border-b border-border">
          <DotGrid />
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
          <EmptyState
            heading={t('emptyHeading', { city: canonicalCity })}
            body={t('emptyBody', { city: canonicalCity })}
            primaryCta={
              <Link href={pricingHref} className="btn-primary">
                {t('emptyAgentCta')}
              </Link>
            }
            secondaryCta={
              <Link href={browseAllHref} className="btn-secondary">
                {t('browseAllCta')}
              </Link>
            }
          />
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
                  <ListingCard
                    listing={l}
                    locale={typedLocale}
                    approxPriceLabel={approxLabels.get(l.id) ?? null}
                    favorited={favoriteIds.has(l.id)}
                    isAuthed={!!userId}
                  />
                </li>
              ))}
            </ul>
            {result.hasMore && (
              <div className="flex justify-center pt-4">
                <Link
                  href={allListingsHref}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
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

