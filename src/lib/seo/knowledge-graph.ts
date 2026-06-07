import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Knowledge-graph data access for the SEO cold-start engine.
 * See docs/SEO_COLD_START_PLAN.md. Reads the real, provenanced geo + market
 * data ingested by scripts/ingest-geo.ts (migration 0082).
 *
 * RLS: geo_* / market_metrics / data_sources are public-read, so the standard
 * anon server client works — no service role needed.
 */

/**
 * Phase 1 flagship markets — a curated, real-estate-relevant subset. We expose
 * ONLY these in the sitemap (controlled indexation: prove these index + rank
 * before scaling to all countries — plan §9). The country PAGE still renders
 * rich data for any country in the graph; the flagship set just gates what we
 * actively push to Google.
 */
export const FLAGSHIP_COUNTRIES = [
  'DO', // Dominican Republic — launch market
  'ES', // Spain
  'PT', // Portugal
  'MX', // Mexico
  'US', // United States
  'CO', // Colombia
  'IT', // Italy
  'FR', // France
  'DE', // Germany
  'CR', // Costa Rica
  'PA', // Panama
  'AE', // United Arab Emirates
  'GR', // Greece
  'TH', // Thailand
  'BR', // Brazil
  'CA', // Canada
] as const;

const FLAGSHIP_SET = new Set<string>(FLAGSHIP_COUNTRIES);

export function isFlagshipCountry(iso2: string): boolean {
  return FLAGSHIP_SET.has(iso2.toUpperCase());
}

export interface CountryMetricSource {
  name: string;
  attribution: string;
  url: string | null;
}

export interface CountryKnowledge {
  iso2: string;
  currencyCode: string | null;
  capital: string | null;
  /** Slug of the capital city row (for linking to its city page). */
  capitalSlug: string | null;
  population: number | null;
  region: string | null;
  gdpPerCapitaUsd: number | null;
  /** Year of the GDP figure, e.g. "2024". */
  gdpYear: string | null;
  gdpSource: CountryMetricSource | null;
}

interface GeoCountryRow {
  iso2: string;
  currency_code: string | null;
  capital: string | null;
  population: number | string | null;
  region: string | null;
}

interface MarketMetricRow {
  value: number | string;
  as_of_date: string;
  data_sources: { name: string; attribution_text: string; url: string | null } | null;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch the real economic snapshot for a country from the knowledge graph.
 * Returns null when the country isn't in the graph (so callers can fall back
 * to the listings-only view).
 */
export async function getCountryKnowledge(
  iso2: string,
): Promise<CountryKnowledge | null> {
  const cc = iso2.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return null;

  const supabase = await createServerSupabaseClient();

  const { data: country, error } = await supabase
    .from('geo_countries')
    .select('iso2, currency_code, capital, population, region')
    .eq('iso2', cc)
    .maybeSingle<GeoCountryRow>();
  if (error) {
    console.error('[getCountryKnowledge] country', error);
    return null;
  }
  if (!country) return null;

  // Capital city slug — we tagged capitals with admin_region='Capital' at
  // ingest, so this is robust once non-capital cities are added later.
  const { data: capCity } = await supabase
    .from('geo_cities')
    .select('slug')
    .eq('country_iso2', cc)
    .eq('admin_region', 'Capital')
    .maybeSingle<{ slug: string }>();

  // Most recent GDP-per-capita metric + its source attribution.
  const { data: gdp } = await supabase
    .from('market_metrics')
    .select('value, as_of_date, data_sources(name, attribution_text, url)')
    .eq('entity_type', 'country')
    .eq('entity_id', cc)
    .eq('metric', 'gdp_per_capita_usd')
    .order('as_of_date', { ascending: false })
    .limit(1)
    .maybeSingle<MarketMetricRow>();

  const gdpValue = gdp ? toNumber(gdp.value) : null;
  const gdpYear = gdp?.as_of_date ? gdp.as_of_date.slice(0, 4) : null;
  const gdpSource = gdp?.data_sources
    ? {
        name: gdp.data_sources.name,
        attribution: gdp.data_sources.attribution_text,
        url: gdp.data_sources.url,
      }
    : null;

  return {
    iso2: cc,
    currencyCode: country.currency_code,
    capital: country.capital,
    capitalSlug: capCity?.slug ?? null,
    population: toNumber(country.population),
    region: country.region,
    gdpPerCapitaUsd: gdpValue,
    gdpYear,
    gdpSource,
  };
}

/**
 * Does the country snapshot have enough real data to render the intro
 * paragraph + indicators block? (Flagship countries all do.)
 */
export function hasRichSnapshot(k: CountryKnowledge | null): boolean {
  return (
    !!k &&
    k.population !== null &&
    k.gdpPerCapitaUsd !== null &&
    !!k.capital &&
    !!k.currencyCode &&
    !!k.region
  );
}
