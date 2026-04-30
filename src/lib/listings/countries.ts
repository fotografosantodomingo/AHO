import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';

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

  const display = (() => {
    try {
      return new Intl.DisplayNames([localeForIntl(locale)], { type: 'region' });
    } catch {
      return null;
    }
  })();

  const rows: CountryRow[] = [];
  for (const [cc, slot] of byCountry.entries()) {
    rows.push({
      countryCode: cc,
      displayName: display?.of(cc) ?? cc,
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
