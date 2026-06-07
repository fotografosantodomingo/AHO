/**
 * SEO knowledge-graph ingest — Phase 0 (real data, keyless).
 * See docs/SEO_COLD_START_PLAN.md §6/§9 + migration 0082.
 *
 * What it does (idempotent upserts):
 *   1. Stamps data_sources.accessed_at for the sources it uses.
 *   2. REST Countries → geo_countries (names in all 7 AHO locales, region,
 *      currency, capital, centroid, population, flag).
 *   3. REST Countries capital → geo_cities (one real city per country with
 *      real coordinates — proves the city pipeline without any API key).
 *   4. World Bank → market_metrics (gdp_per_capita_usd per country, with a
 *      real source_id + as_of_date — proves the provenanced-metric pipeline).
 *
 * NOT in Phase 0 (documented follow-ups): full city lists (GeoNames dumps),
 * neighborhoods (OSM), price indices (BIS/OECD/Eurostat). Those land in
 * Phases 2-3 per the plan.
 *
 * Requires migration 0082 to be applied first (tables must exist).
 *
 * Run:  set -a && source .env.local && set +a && pnpm tsx scripts/ingest-geo.ts
 *       (optionally scope to specific countries: ... ingest-geo.ts DO ES PT)
 *
 * HARD RULE (plan §6): no numeric metric is inserted without a real source_id.
 */
import postgres from 'postgres';

const POOLER_URL = process.env.SUPABASE_POOLER_URL;
if (!POOLER_URL) {
  console.error('SUPABASE_POOLER_URL not set — source .env.local first.');
  process.exit(1);
}

// Optional CLI scoping: `... ingest-geo.ts DO ES PT` limits to those ISO2s.
const SCOPE = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));

// REST Countries translation keys → AHO UI locales.
const TRANSLATION_KEY: Record<string, string> = {
  es: 'spa',
  de: 'deu',
  fr: 'fra',
  it: 'ita',
  pt: 'por',
  pl: 'pol',
};

/** ASCII, hyphenated, lowercase slug — diacritics folded. */
function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface CountryRow {
  iso2: string;
  iso3: string | null;
  names: Record<string, string>;
  region: string | null;
  subregion: string | null;
  currency: string | null;
  capital: string | null;
  capitalLatLng: [number, number] | null; // [lat, lng]
  centroid: string | null; // EWKT
  population: number | null;
  flag: string | null;
}

async function fetchCountries(): Promise<CountryRow[]> {
  // `fields` is mandatory on REST Countries v3.1 /all.
  const fields =
    'cca2,cca3,name,translations,region,subregion,capital,capitalInfo,currencies,latlng,population,flag';
  const res = await fetch(`https://restcountries.com/v3.1/all?fields=${fields}`);
  if (!res.ok) throw new Error(`REST Countries ${res.status}`);
  const raw = (await res.json()) as any[];
  const rows: CountryRow[] = [];
  for (const c of raw) {
    const iso2: string | undefined = c.cca2;
    if (!iso2 || !/^[A-Z]{2}$/.test(iso2)) continue;
    if (SCOPE.size > 0 && !SCOPE.has(iso2)) continue;

    const names: Record<string, string> = { en: c.name?.common ?? iso2 };
    for (const [locale, key] of Object.entries(TRANSLATION_KEY)) {
      const t = c.translations?.[key]?.common;
      if (t) names[locale] = t;
    }
    const latlng: number[] | undefined = c.latlng;
    const centroid =
      Array.isArray(latlng) &&
      typeof latlng[0] === 'number' &&
      typeof latlng[1] === 'number'
        ? `SRID=4326;POINT(${latlng[1]} ${latlng[0]})`
        : null;
    const capLatLng: number[] | undefined = c.capitalInfo?.latlng;
    const capPair: [number, number] | null =
      Array.isArray(capLatLng) &&
      typeof capLatLng[0] === 'number' &&
      typeof capLatLng[1] === 'number'
        ? [capLatLng[0], capLatLng[1]]
        : null;
    const currency = c.currencies ? Object.keys(c.currencies)[0] ?? null : null;

    rows.push({
      iso2,
      iso3: c.cca3 ?? null,
      names,
      region: c.region ?? null,
      subregion: c.subregion ?? null,
      currency,
      capital: Array.isArray(c.capital) ? c.capital[0] ?? null : null,
      capitalLatLng: capPair,
      centroid,
      population: typeof c.population === 'number' ? c.population : null,
      flag: c.flag ?? null,
    });
  }
  return rows;
}

interface GdpDatum {
  iso2: string;
  value: number;
  year: string;
}

async function fetchGdpPerCapita(): Promise<GdpDatum[]> {
  // mrnev=1 → most recent non-empty value per country, one row each.
  const out: GdpDatum[] = [];
  let page = 1;
  let pages = 1;
  do {
    const url = `https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?format=json&mrnev=1&per_page=300&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`World Bank ${res.status}`);
    const body = (await res.json()) as any[];
    const meta = body[0];
    pages = meta?.pages ?? 1;
    const data = (body[1] ?? []) as any[];
    for (const d of data) {
      const iso2: string | undefined = d.country?.id;
      const value = d.value;
      if (!iso2 || !/^[A-Z]{2}$/.test(iso2) || typeof value !== 'number') continue;
      if (SCOPE.size > 0 && !SCOPE.has(iso2)) continue;
      out.push({ iso2, value, year: d.date });
    }
    page++;
  } while (page <= pages);
  return out;
}

async function main() {
  const sql = postgres(POOLER_URL!, { max: 1, prepare: false });
  try {
    // Resolve seeded source ids (migration 0082 inserts these).
    const sources = await sql`select slug, id from public.data_sources`;
    const sourceId = new Map<string, string>(
      sources.map((r: any) => [r.slug, r.id]),
    );
    const restId = sourceId.get('rest_countries');
    const wbId = sourceId.get('world_bank');
    if (!restId || !wbId) {
      throw new Error(
        'data_sources rows missing — is migration 0082 applied? (need rest_countries + world_bank).',
      );
    }

    console.error('Fetching REST Countries…');
    const countries = await fetchCountries();
    console.error(`  ${countries.length} countries`);

    let cityCount = 0;
    for (const c of countries) {
      await sql`
        insert into public.geo_countries
          (iso2, iso3, names, region, subregion, currency_code, capital, centroid, population, flag_emoji, source_id)
        values (
          ${c.iso2}, ${c.iso3}, ${sql.json(c.names)}, ${c.region}, ${c.subregion},
          ${c.currency}, ${c.capital},
          ${c.centroid ? sql`${c.centroid}::geography` : null},
          ${c.population}, ${c.flag}, ${restId}
        )
        on conflict (iso2) do update set
          iso3 = excluded.iso3, names = excluded.names, region = excluded.region,
          subregion = excluded.subregion, currency_code = excluded.currency_code,
          capital = excluded.capital, centroid = excluded.centroid,
          population = excluded.population, flag_emoji = excluded.flag_emoji,
          source_id = excluded.source_id, updated_at = now()
      `;

      // Capital → first real city for the country (keyless, real coords).
      if (c.capital) {
        const citySlug = slugify(c.capital);
        if (citySlug) {
          const cityCentroid = c.capitalLatLng
            ? `SRID=4326;POINT(${c.capitalLatLng[1]} ${c.capitalLatLng[0]})`
            : null;
          const cityNames: Record<string, string> = { en: c.capital };
          await sql`
            insert into public.geo_cities
              (country_iso2, slug, names, admin_region, centroid, source_id)
            values (
              ${c.iso2}, ${citySlug}, ${sql.json(cityNames)}, ${'Capital'},
              ${cityCentroid ? sql`${cityCentroid}::geography` : null}, ${restId}
            )
            on conflict (country_iso2, slug) do update set
              names = excluded.names, centroid = excluded.centroid,
              source_id = excluded.source_id, updated_at = now()
          `;
          cityCount++;
        }
      }
    }
    console.error(`  upserted ${countries.length} countries + ${cityCount} capital cities`);

    console.error('Fetching World Bank GDP per capita…');
    const gdp = await fetchGdpPerCapita();
    const haveCountry = new Set(countries.map((c) => c.iso2));
    let metricCount = 0;
    for (const g of gdp) {
      if (!haveCountry.has(g.iso2)) continue; // skip aggregates / unseeded
      await sql`
        insert into public.market_metrics
          (entity_type, entity_id, metric, value, unit, as_of_date, source_id)
        values ('country', ${g.iso2}, 'gdp_per_capita_usd', ${g.value}, 'USD', ${`${g.year}-01-01`}, ${wbId})
        on conflict (entity_type, entity_id, metric, as_of_date) do update set
          value = excluded.value, unit = excluded.unit,
          source_id = excluded.source_id, updated_at = now()
      `;
      metricCount++;
    }
    console.error(`  upserted ${metricCount} gdp_per_capita_usd metrics`);

    // Stamp accessed_at for the sources we just pulled.
    await sql`update public.data_sources set accessed_at = now() where slug in ('rest_countries','world_bank')`;

    console.error('\nDONE: knowledge-graph ingest complete.');
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('INGEST FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
