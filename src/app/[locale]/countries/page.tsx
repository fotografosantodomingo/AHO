import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { getCountriesIndex, getGlobalSearchIndex } from '@/lib/listings/countries';
import { FLAGSHIP_COUNTRIES } from '@/lib/seo/knowledge-graph';
import { getCountryName } from '@/lib/i18n/countries';
import { DotGrid } from '@/components/ui/dot-grid';
import { CountryCityCombobox } from '@/components/listings/country-city-combobox';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  buildBreadcrumbList,
  buildCollectionPage,
  buildGraph,
  buildItemList,
} from '@/lib/seo/jsonld';

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
  const languages: Record<string, string> = {};
  for (const lc of LOCALES) {
    languages[lc] = `${site}${localePath(lc, '/countries')}`;
  }
  languages['x-default'] = `${site}${localePath('en', '/countries')}`;
  const canonical = `${site}${localePath(locale as Locale, '/countries')}`;
  return {
    title: t('heading'),
    description: t('subheading'),
    alternates: {
      canonical,
      languages,
    },
    openGraph: {
      type: 'website',
      url: canonical,
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
  // Run both queries in parallel — they touch the same source table but
  // are different shapes (grouped vs flat). Edge runtime makes the cost
  // negligible, and parallelism halves wall-clock vs sequential awaits.
  const [rows, searchIndex] = await Promise.all([
    getCountriesIndex(typedLocale),
    getGlobalSearchIndex(typedLocale),
  ]);

  const countryStem = localePath(typedLocale, '/properties-in/[country]').replace(
    '/[country]',
    '',
  );
  const countryHref = (cc: string) => `${countryStem}/${cc.toLowerCase()}`;
  const browseHref = localePath(typedLocale, '/search');
  const pricingHref = localePath(typedLocale, '/pricing');

  // Flagship markets — the real-data country hubs (SEO cold-start, plan §9).
  // Always shown so they have a crawlable internal-link path (sitemap-only
  // pages index poorly). Sorted by localized name.
  const flagshipMarkets = FLAGSHIP_COUNTRIES.map((cc) => ({
    cc,
    name: getCountryName(cc, typedLocale),
  })).sort((a, b) => a.name.localeCompare(b.name, typedLocale));

  // JSON-LD: CollectionPage + ItemList (one entry per country with
  // listings) + BreadcrumbList. Only emit ItemList when rows exist —
  // an empty list reads as a noise signal to crawlers.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const pageUrl = `${site}${localePath(typedLocale, '/countries')}`;
  const homeUrl = `${site}/${typedLocale}`;
  const itemListId = `${pageUrl}#countries`;
  // Union: listing-countries first, then flagship hubs not already listed.
  // Always non-empty (flagship set), so the ItemList always emits.
  const seenCc = new Set<string>();
  const itemEntries: Array<{ url: string; name: string }> = [];
  for (const row of rows) {
    itemEntries.push({
      url: `${site}${countryHref(row.countryCode)}`,
      name: row.displayName,
    });
    seenCc.add(row.countryCode.toUpperCase());
  }
  for (const f of flagshipMarkets) {
    if (seenCc.has(f.cc)) continue;
    itemEntries.push({ url: `${site}${countryHref(f.cc)}`, name: f.name });
  }
  const itemListNode = buildItemList({
    name: t('heading'),
    id: itemListId,
    entries: itemEntries,
  });
  const collectionNode = buildCollectionPage({
    name: t('heading'),
    url: pageUrl,
    description: t('subheading'),
    inLanguage: typedLocale,
    publisherId: 'https://advertisehomes.online/#organization',
    isPartOfId: 'https://advertisehomes.online/#website',
    hasPartId: itemListId,
  });
  const breadcrumbNode = buildBreadcrumbList([
    { name: 'AHO', url: homeUrl },
    { name: t('heading'), url: pageUrl },
  ]);
  const graph = buildGraph([collectionNode, itemListNode, breadcrumbNode]);

  return (
    <main>
      <JsonLd node={graph} />
      <section className="relative overflow-hidden border-b border-border">
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
          {searchIndex.length > 0 && (
            <div className="mt-6 max-w-xl">
              <CountryCityCombobox
                entries={searchIndex}
                placeholder={t('searchPlaceholder')}
                ariaLabel={t('searchAriaLabel')}
                noResultsLabel={t('searchNoResults')}
                countriesGroupLabel={t('searchGroupCountries')}
                citiesGroupLabel={t('searchGroupCities')}
                listingsCountSingular={t('listingsCount_one')}
                listingsCountPlural={t('listingsCount_other')}
              />
            </div>
          )}
        </div>
      </section>

      {/* Featured markets — always-on internal-link hub to the flagship
          country pages (real-data market snapshots). Gives crawlers a path
          to them so they don't sit orphaned in the sitemap. */}
      <section className="border-b border-border bg-surface-warm/40 dark:bg-surface-deep/40">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <h2 className="font-brand text-xl font-semibold tracking-tight">
            {t('featuredMarketsHeading')}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('featuredMarketsSub')}
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {flagshipMarkets.map((m) => (
              <li key={m.cc}>
                <Link
                  href={countryHref(m.cc)}
                  className="flex items-center justify-between gap-2 rounded-card border border-border bg-surface px-4 py-3 text-sm shadow-whisper transition hover:-translate-y-0.5 hover:border-border-strong/60 hover:shadow-lg dark:bg-surface-deep"
                >
                  <span className="min-w-0 truncate font-medium">{m.name}</span>
                  <span className="text-[11px] uppercase tracking-wider text-helper">
                    {m.cc}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-6 py-12">
        {rows.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong/60 bg-surface p-10 text-center shadow-whisper dark:bg-surface-deep">
            <p className="font-brand text-base font-semibold">{t('emptyHeading')}</p>
            <p className="mx-auto mt-3 max-w-md text-sm text-helper">
              {t('emptyBody')}
            </p>
            <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Link
                href={pricingHref}
                className="btn-primary"
              >
                {t('emptyAgentCta')}
              </Link>
              <Link
                href={browseHref}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
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
