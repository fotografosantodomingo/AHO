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
  const result = await searchListings(filters, typedLocale);

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

  return (
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

      <SearchFilters locale={typedLocale} filters={filters} />

      <nav aria-label="View toggle" className="flex gap-1">
        <a
          href={listViewHref}
          className={`inline-flex h-8 items-center rounded-lg px-3 text-sm transition ${
            view === 'list'
              ? 'bg-surface-dark text-ink-inverse-muted shadow-whisper'
              : 'border border-border-strong text-helper hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          {t('viewList')}
        </a>
        <a
          href={mapViewHref}
          className={`inline-flex h-8 items-center rounded-lg px-3 text-sm transition ${
            view === 'map'
              ? 'bg-surface-dark text-ink-inverse-muted shadow-whisper'
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
        noResultsLabel={t('noResults')}
        noResultsHintLabel={t('noResultsHint')}
        prevPageLabel={t('previousPage')}
        nextPageLabel={t('nextPage')}
        resetBboxLabel={t('resetBbox')}
        bboxActiveLabel={t('bboxActive')}
      />
    </main>
  );
}
