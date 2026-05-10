import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import {
  buildSearchUrl,
  parseFilters,
  searchListings,
} from '@/lib/listings/search';
import { SearchFilters } from '@/components/listings/search-filters';
import { SearchResultsView } from '@/components/listings/search-results-view';
import { SaveSearchButton } from '@/components/saved-searches/save-search-button';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { getUserFavoriteIds } from '@/lib/listings/favorites';
import { getCountriesIndex } from '@/lib/listings/countries';
import { publicEnv } from '@/lib/env';
import { buildWebSite, serializeJsonLd } from '@/lib/seo/jsonld';

export const runtime = 'edge';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'search' });
  return {
    title: t('heading'),
    // Crawl-control: search results pages are intentionally excluded from
    // the index per HANDOFF §16.7 (faceted URLs cause infinite crawl).
    // Canonical city / neighborhood landing pages serve as indexable browse.
    robots: { index: false, follow: true },
  };
}

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const t = await getTranslations({ locale, namespace: 'search' });
  // Run search + country options in parallel — the country dropdown
  // needs the same fixture-filtered set as /countries.
  const [result, countriesIndex] = await Promise.all([
    searchListings(filters, typedLocale),
    getCountriesIndex(typedLocale),
  ]);

  // Approx-converted price labels for each visible listing. One rate
  // fetch per page render. Bbox-driven updates degrade to source-only
  // (the by-bbox endpoint doesn't return labels in v1).
  const approxLabelMap = await precomputeApproxLabels(
    result.listings.map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      currency: l.currency,
    })),
    typedLocale,
  );
  const initialApproxLabels: Record<string, string> = {};
  for (const [k, v] of approxLabelMap.entries()) initialApproxLabels[k] = v;

  // View toggle: ?view=map switches the results grid for a Leaflet map.
  // Default is the list view. Querystring source of truth so map view is
  // bookmarkable + shareable.
  const rawView = typeof sp.view === 'string' ? sp.view : 'list';
  const view: 'list' | 'map' = rawView === 'map' ? 'map' : 'list';

  // Auth check for the Save Search button — we only want to expose the
  // save action to signed-in users; anon callers see a "Sign in to save"
  // link instead. Don't block the search page on auth — anon browse stays
  // first-class.
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const isAuthenticated = !!userResult.user;
  const favoriteIds = await getUserFavoriteIds(
    supabase,
    userResult.user?.id ?? null,
    result.listings.map((l) => l.id),
  );

  const prevHref =
    filters.page > 1
      ? buildSearchUrl(typedLocale, { ...filters, page: filters.page - 1 })
      : null;
  const nextHref = result.hasMore
    ? buildSearchUrl(typedLocale, { ...filters, page: filters.page + 1 })
    : null;

  // View-toggle URLs preserve all current filters; we only flip the
  // `view` param. buildSearchUrl doesn't know about `view`, so append.
  const filterQs = (() => {
    const url = new URL(`http://x${buildSearchUrl(typedLocale, filters)}`);
    return url.search.replace(/^\?/, '');
  })();
  const listViewHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}${
    filterQs ? `?${filterQs}` : ''
  }`;
  const mapViewHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}?${
    filterQs ? `${filterQs}&` : ''
  }view=map`;

  // JSON-LD: WebSite + SearchAction so Google can render the sitelinks
  // search box on branded SERPs ("AHO" → searchbox in the result). The
  // /search page itself is robots:noindex (faceted URLs cause infinite
  // crawl loops per HANDOFF §16.7), but the WebSite schema is keyed by
  // the locale-rooted home URL and is independent of the noindex on
  // this page — Google still picks it up because crawlers follow
  // sitelinks-searchbox to the home, fetch this page once for the
  // schema, and don't re-index its faceted variants. The placeholder
  // `{search_term_string}` is required by Google's spec; the helper
  // throws if it's missing.
  const tSite = await getTranslations({ locale, namespace: 'site' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const homeUrl = `${site}/${locale}`;
  const searchPath =
    typedLocale === 'es' ? 'buscar' : 'search';
  const websiteLd = buildWebSite({
    name: tSite('name'),
    url: homeUrl,
    inLanguage: typedLocale,
    searchUrlTemplate: `${site}/${locale}/${searchPath}?q={search_term_string}`,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteLd) }}
      />
      {/* Pre-warm TLS to the OpenStreetMap tile origin the moment a
          visitor lands on /search. The map view is one click away (or
          already rendered if `?view=map`), and on a mobile connection
          the TLS handshake to a new origin is the long pole.
          dns-prefetch + preconnect double-up keeps support-matrix-wide
          coverage — Safari and Firefox honor only one or the other
          depending on version. Next.js 15 hoists these <link> elements
          into <head>. The unpkg.com preconnect was removed when
          Leaflet's CSS moved to self-hosted /leaflet/* — same-origin
          CSS doesn't need a separate handshake. */}
      <link rel="dns-prefetch" href="https://tile.openstreetmap.org" />
      <link
        rel="preconnect"
        href="https://tile.openstreetmap.org"
        crossOrigin="anonymous"
      />
      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[34px] md:leading-[1.18]">
          {t('heading')}
        </h1>
        <SaveSearchButton
          filters={{
            q: filters.q,
            city: filters.city,
            transaction: filters.transaction,
            minPrice: filters.minPrice,
            maxPrice: filters.maxPrice,
            bedsMin: filters.bedsMin,
          }}
          isAuthenticated={isAuthenticated}
        />
      </header>

      <SearchFilters
        locale={typedLocale}
        filters={filters}
        countryOptions={countriesIndex.map((c) => ({
          code: c.countryCode,
          name: c.displayName,
        }))}
      />

      <nav aria-label="View toggle" className="flex gap-1">
        <a
          href={listViewHref}
          className={`inline-flex h-11 items-center rounded-lg px-4 text-sm transition md:h-9 md:px-3 ${
            view === 'list'
              ? 'bg-action text-white shadow-whisper dark:bg-action-dark dark:text-surface-deep'
              : 'border border-border-strong text-helper hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          {t('viewList')}
        </a>
        <a
          href={mapViewHref}
          className={`inline-flex h-11 items-center rounded-lg px-4 text-sm transition md:h-9 md:px-3 ${
            view === 'map'
              ? 'bg-action text-white shadow-whisper dark:bg-action-dark dark:text-surface-deep'
              : 'border border-border-strong text-helper hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          {t('viewMap')}
        </a>
      </nav>

      <SearchResultsView
        initialListings={result.listings}
        initialHasMore={result.hasMore}
        filters={filters}
        locale={typedLocale}
        view={view}
        prevHref={prevHref}
        nextHref={nextHref}
        resultsCountTemplate={t('resultsCount_other', { count: result.listings.length })}
        // Pre-resolved "in this area" template — the literal {count}
        // placeholder is preserved client-side so the count stays live
        // as the user pans. Plural form: `_other` covers all counts;
        // the `_one` variant is selected client-side via the count value
        // when needed (count === 1) — but `_other` with count=1 reads
        // fine in EN/ES and we can ship both as separate strings later
        // if a stricter language requires it.
        resultsCountInAreaTemplate={t('resultsCountInArea_other', {
          count: result.listings.length,
        })}
        noResultsLabel={t('noResults')}
        noResultsHintLabel={t('noResultsHint')}
        prevPageLabel={t('previousPage')}
        nextPageLabel={t('nextPage')}
        resetBboxLabel={t('resetBbox')}
        bboxActiveLabel={t('bboxActive')}
        initialApproxLabels={initialApproxLabels}
        initialFavoriteIds={Array.from(favoriteIds)}
        isAuthed={isAuthenticated}
      />
      </main>
    </>
  );
}
