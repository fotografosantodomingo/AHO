import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import {
  buildSearchUrl,
  parseFilters,
  searchListings,
} from '@/lib/listings/search';
import { ListingCard } from '@/components/listings/listing-card';
import { SearchFilters } from '@/components/listings/search-filters';

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

  const prevHref =
    filters.page > 1
      ? buildSearchUrl(typedLocale, { ...filters, page: filters.page - 1 })
      : null;
  const nextHref = result.hasMore
    ? buildSearchUrl(typedLocale, { ...filters, page: filters.page + 1 })
    : null;

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
      </header>

      <SearchFilters locale={typedLocale} filters={filters} />

      {result.listings.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <p>{t('noResults')}</p>
          <p className="mt-2 text-xs text-zinc-500">{t('noResultsHint')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-zinc-500">
            {t('resultsCount_other', { count: result.listings.length })}
            {result.hasMore ? '+' : ''}
          </p>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.listings.map((l) => (
              <li key={l.id}>
                <ListingCard listing={l} locale={typedLocale} />
              </li>
            ))}
          </ul>
        </>
      )}

      {(prevHref || nextHref) && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800"
        >
          {prevHref ? (
            <a
              href={prevHref}
              className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              {t('previousPage')}
            </a>
          ) : (
            <span />
          )}
          {nextHref && (
            <a
              href={nextHref}
              className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              {t('nextPage')}
            </a>
          )}
        </nav>
      )}
    </main>
  );
}
