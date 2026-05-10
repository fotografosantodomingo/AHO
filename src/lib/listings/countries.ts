import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/locale-path';
import { getCountryName } from '@/lib/i18n/countries';

export interface CountryRow {
  countryCode: string;
  /** Localized display name via Intl.DisplayNames. */
  displayName: string;
  listingCount: number;
  /** Distinct cities with active listings in the country. */
  cityCount: number;
}

export interface CountryCityRow {
  city: string;
  citySlug: string;
  listingCount: number;
}

function localeForIntl(locale: Locale): string {
  return locale === 'es' ? 'es-DO' : 'en-US';
}

function citySlugify(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Search-index entry — flat shape consumed by the country/city combobox
 * on the /countries page. Two kinds: a country-level row that links to
 * `/properties-in/{cc}`, and a city-level row that drills one level deeper
 * to `/properties-in/{cc}/{city-slug}`. Both carry a localized display
 * label (already concatenated for cities — "City, Country" — to spare the
 * client component from re-localizing).
 */
export type SearchIndexEntry =
  | {
      kind: 'country';
      countryCode: string;
      displayName: string;
      listingCount: number;
      cityCount: number;
      href: string;
    }
  | {
      kind: 'city';
      countryCode: string;
      city: string;
      citySlug: string;
      displayName: string;
      listingCount: number;
      href: string;
    };

/**
 * Aggregate listings by country for the /countries directory page.
 *
 * Pulls every active+published listing's (country_code, city) pair, filters
 * out test fixtures via inner-join + defensive slug check, then groups in
 * memory. Edge runtime makes this cheap; we don't need a DB-side rollup.
 *
 * Empty result is honest emptiness (real-only data rule). The page renders
 * an empty state when no countries have listings yet.
 */
export async function getCountriesIndex(locale: Locale): Promise<CountryRow[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('properties')
    .select('country_code, city, slug_en, slug_es, organizations!inner(slug)')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%');

  if (error) {
    console.error('[getCountriesIndex]', error);
    return [];
  }

  const filtered = (data ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const byCountry = new Map<string, { count: number; cities: Set<string> }>();
  for (const row of filtered) {
    const cc = row.country_code?.toUpperCase();
    if (!cc) continue;
    const slot = byCountry.get(cc) ?? { count: 0, cities: new Set<string>() };
    slot.count += 1;
    if (row.city) slot.cities.add(row.city.trim().toLowerCase());
    byCountry.set(cc, slot);
  }

  const rows: CountryRow[] = [];
  for (const [cc, slot] of byCountry.entries()) {
    rows.push({
      countryCode: cc,
      displayName: getCountryName(cc, locale),
      listingCount: slot.count,
      cityCount: slot.cities.size,
    });
  }
  // Sort by listing count desc, then localized display name.
  rows.sort((a, b) => {
    if (b.listingCount !== a.listingCount) return b.listingCount - a.listingCount;
    return a.displayName.localeCompare(b.displayName, localeForIntl(locale));
  });
  return rows;
}

/**
 * Cities (with active listing counts) inside a single country, for the
 * country-level landing page. Same fixture-exclusion pattern as the
 * directory helper.
 */
export async function getCountryCities(
  countryCode: string,
): Promise<{ displayCountry: string; cities: CountryCityRow[] }> {
  const supabase = await createServerSupabaseClient();
  const cc = countryCode.toUpperCase();

  const { data, error } = await supabase
    .from('properties')
    .select('city, slug_en, slug_es, organizations!inner(slug)')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .eq('country_code', cc)
    .not('organizations.slug', 'like', 'aho-test-org-%');

  if (error) {
    console.error('[getCountryCities]', error);
    return { displayCountry: cc, cities: [] };
  }

  const filtered = (data ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const byCity = new Map<string, number>();
  for (const row of filtered) {
    if (!row.city) continue;
    const key = row.city.trim();
    byCity.set(key, (byCity.get(key) ?? 0) + 1);
  }

  const cities: CountryCityRow[] = [...byCity.entries()].map(([city, count]) => ({
    city,
    citySlug: citySlugify(city),
    listingCount: count,
  }));
  cities.sort((a, b) => {
    if (b.listingCount !== a.listingCount) return b.listingCount - a.listingCount;
    return a.city.localeCompare(b.city);
  });

  return { displayCountry: cc, cities };
}

/**
 * Flat search index for the /countries combobox. Each row in
 * `properties` becomes either a country-level or city-level entry,
 * counted and de-duplicated server-side. We materialize this once per
 * request and inline it into the page so the client-side typeahead
 * doesn't need a network round-trip per keystroke.
 *
 * Sort order: city listing count desc, then country listing count desc,
 * then localized display name. The page renders countries above cities
 * regardless of sort by partitioning client-side.
 */
export async function getGlobalSearchIndex(
  locale: Locale,
): Promise<SearchIndexEntry[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('properties')
    .select('country_code, city, slug_en, slug_es, organizations!inner(slug)')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%');

  if (error) {
    console.error('[getGlobalSearchIndex]', error);
    return [];
  }

  const filtered = (data ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const countries = new Map<string, { count: number; cities: Map<string, number> }>();
  for (const row of filtered) {
    const cc = row.country_code?.toUpperCase();
    if (!cc) continue;
    const slot = countries.get(cc) ?? { count: 0, cities: new Map<string, number>() };
    slot.count += 1;
    if (row.city) {
      const key = row.city.trim();
      slot.cities.set(key, (slot.cities.get(key) ?? 0) + 1);
    }
    countries.set(cc, slot);
  }

  // Resolve segments via PATHNAMES (#7).
  const countryStem = localePath(locale, '/properties-in/[country]').replace(
    '/[country]',
    '',
  );
  const cityStem = localePath(locale, '/properties-in/[country]/[city]').replace(
    '/[country]/[city]',
    '',
  );
  const entries: SearchIndexEntry[] = [];
  for (const [cc, slot] of countries.entries()) {
    const countryDisplay = getCountryName(cc, locale);
    entries.push({
      kind: 'country',
      countryCode: cc,
      displayName: countryDisplay,
      listingCount: slot.count,
      cityCount: slot.cities.size,
      href: `${countryStem}/${cc.toLowerCase()}`,
    });
    for (const [city, count] of slot.cities.entries()) {
      const citySlug = citySlugify(city);
      entries.push({
        kind: 'city',
        countryCode: cc,
        city,
        citySlug,
        displayName: `${city}, ${countryDisplay}`,
        listingCount: count,
        href: `${cityStem}/${cc.toLowerCase()}/${citySlug}`,
      });
    }
  }

  entries.sort((a, b) => {
    if (b.listingCount !== a.listingCount) return b.listingCount - a.listingCount;
    return a.displayName.localeCompare(b.displayName, localeForIntl(locale));
  });
  return entries;
}
