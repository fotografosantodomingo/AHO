-- 0082_seo_knowledge_graph.sql
--
-- SEO cold-start Phase 0 — the Location Knowledge Graph.
-- See docs/SEO_COLD_START_PLAN.md (§4 schema, §6 data integrity).
--
-- Strategy recap: AHO has a marketplace cold-start problem (empty inventory →
-- thin SEO). Instead of seeding FAKE listings (rejected — CLAUDE.md hard rule
-- #8, and it backfires under Google's scaled-content-abuse policy), we build a
-- knowledge graph of REAL geo + market data that ranks on its own and never
-- needs teardown. Entities (country → city → neighborhood) drive auto-generated,
-- interlinked pages (market data, buying guides, comparisons, agent
-- service-area pages).
--
-- HARD RULE (SEO, see plan §6): no numeric market claim ships without a real
-- `data_sources` row + `as_of_date`. The `market_metrics.source_id` FK is NOT
-- NULL precisely to enforce this at the schema level — a hallucinated stat is
-- fake data in a YMYL context. AI may write prose around real numbers; it may
-- never invent the numbers.
--
-- Reference helpers already in the DB:
--   public.touch_updated_at()    — 0001, updated_at trigger
--   public.is_platform_admin()   — 0002, admin check
--   PostGIS geography(Point,4326) — 0001 (extension enabled)
--
-- RLS shape:
--   geo_* / data_sources / market_metrics → public READ (meant to be indexed),
--     service-role-only writes (+ belt-and-suspenders REVOKE).
--   content_guides → public READ only when status='published'; admin reads all;
--     service-role-only writes.

-- ════════════════════════════════════════════════════════════════════
-- data_sources — provenance + license registry.
-- Every numeric fact on a page joins back to one of these rows so the page
-- can render "Source: World Bank, 2024" (an E-E-A-T signal, not overhead).
-- ════════════════════════════════════════════════════════════════════

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  -- Stable machine key referenced by the ingest pipeline (e.g. 'world_bank').
  slug text not null unique check (slug ~ '^[a-z0-9_]+$'),
  name text not null check (char_length(name) between 2 and 200),
  url text check (url is null or url ~* '^https?://'),
  -- License identifier, e.g. 'CC BY 4.0', 'ODbL', 'CC BY-SA 4.0', 'public'.
  license text not null,
  -- The exact attribution string rendered on pages that use this source.
  attribution_text text not null check (char_length(attribution_text) between 2 and 500),
  -- When the data was last pulled. The ingest pipeline stamps this.
  accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger data_sources_touch_updated_at
  before update on public.data_sources
  for each row execute function public.touch_updated_at();

comment on table public.data_sources is
  'Provenance + license registry for SEO knowledge-graph facts. Every market_metrics row references one. Pages render attribution_text. See docs/SEO_COLD_START_PLAN.md §6.';

-- Seed the canonical real sources (static reference metadata, NOT marketplace
-- data — permitted; these are license/attribution descriptors). The ingest
-- pipeline upserts accessed_at on each run.
insert into public.data_sources (slug, name, url, license, attribution_text) values
  ('rest_countries', 'REST Countries', 'https://restcountries.com', 'public (Mozilla Public License 2.0)', 'Country data via REST Countries (restcountries.com).'),
  ('world_bank', 'World Bank Open Data', 'https://data.worldbank.org', 'CC BY 4.0', 'Source: World Bank Open Data (data.worldbank.org), CC BY 4.0.'),
  ('geonames', 'GeoNames', 'https://www.geonames.org', 'CC BY 4.0', 'Geographic data © GeoNames (geonames.org), CC BY 4.0.'),
  ('openstreetmap', 'OpenStreetMap', 'https://www.openstreetmap.org', 'ODbL', '© OpenStreetMap contributors, ODbL.'),
  ('wikidata', 'Wikidata', 'https://www.wikidata.org', 'CC0 1.0 / CC BY-SA 4.0', 'Data from Wikidata (wikidata.org).'),
  ('eurostat', 'Eurostat', 'https://ec.europa.eu/eurostat', 'CC BY 4.0', 'Source: Eurostat (ec.europa.eu/eurostat).'),
  ('oecd', 'OECD', 'https://data.oecd.org', 'CC BY 4.0 (most datasets)', 'Source: OECD (data.oecd.org).'),
  ('bis', 'Bank for International Settlements', 'https://www.bis.org/statistics', 'BIS terms (free reuse with attribution)', 'Source: BIS residential property price statistics (bis.org).')
on conflict (slug) do nothing;

-- ════════════════════════════════════════════════════════════════════
-- geo_countries — top of the hierarchy. PK is uppercase ISO-3166-1 alpha-2
-- to match the existing properties.country_code convention (page slugs use
-- the lowercase form, e.g. /properties-in/do/...).
-- ════════════════════════════════════════════════════════════════════

create table public.geo_countries (
  iso2 char(2) primary key check (iso2 ~ '^[A-Z]{2}$'),
  iso3 char(3) check (iso3 is null or iso3 ~ '^[A-Z]{3}$'),
  -- Localized display names keyed by AHO UI locale, e.g.
  -- {"en":"Dominican Republic","es":"República Dominicana","de":"…"}.
  -- jsonb (not 7 columns) keeps the 7-locale fan-out manageable across the
  -- three geo tables; REST Countries supplies the translations.
  names jsonb not null default '{}'::jsonb,
  region text,
  subregion text,
  currency_code char(3),
  capital text,
  centroid geography(Point, 4326),
  population bigint check (population is null or population >= 0),
  flag_emoji text,
  source_id uuid references public.data_sources(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_geo_countries_region on public.geo_countries(region);
create index idx_geo_countries_centroid on public.geo_countries using gist(centroid);

create trigger geo_countries_touch_updated_at
  before update on public.geo_countries
  for each row execute function public.touch_updated_at();

comment on table public.geo_countries is
  'SEO knowledge graph — countries. names is locale→display-name jsonb. Page slug = lower(iso2). See docs/SEO_COLD_START_PLAN.md §4.';

-- ════════════════════════════════════════════════════════════════════
-- geo_cities — cities within a country. slug is hyphenated lowercase to
-- match the existing city-landing URL convention (santo-domingo, …).
-- ════════════════════════════════════════════════════════════════════

create table public.geo_cities (
  id uuid primary key default gen_random_uuid(),
  country_iso2 char(2) not null references public.geo_countries(iso2) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  names jsonb not null default '{}'::jsonb,
  admin_region text,                     -- state / province / department
  centroid geography(Point, 4326),
  population bigint check (population is null or population >= 0),
  -- External de-dup key when ingesting from GeoNames dumps.
  geonames_id bigint unique,
  source_id uuid references public.data_sources(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_iso2, slug)
);

create index idx_geo_cities_country on public.geo_cities(country_iso2);
create index idx_geo_cities_centroid on public.geo_cities using gist(centroid);
create index idx_geo_cities_population on public.geo_cities(population desc nulls last);

create trigger geo_cities_touch_updated_at
  before update on public.geo_cities
  for each row execute function public.touch_updated_at();

comment on table public.geo_cities is
  'SEO knowledge graph — cities. unique(country_iso2, slug) maps 1:1 to /properties-in/{country}/{city}. See docs/SEO_COLD_START_PLAN.md §4.';

-- ════════════════════════════════════════════════════════════════════
-- geo_neighborhoods — neighborhoods within a city (Phase 3 content, schema
-- now so the graph is complete). boundary optional (PostGIS polygon).
-- ════════════════════════════════════════════════════════════════════

create table public.geo_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.geo_cities(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  names jsonb not null default '{}'::jsonb,
  centroid geography(Point, 4326),
  boundary geography(Polygon, 4326),
  source_id uuid references public.data_sources(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (city_id, slug)
);

create index idx_geo_neighborhoods_city on public.geo_neighborhoods(city_id);
create index idx_geo_neighborhoods_centroid on public.geo_neighborhoods using gist(centroid);

create trigger geo_neighborhoods_touch_updated_at
  before update on public.geo_neighborhoods
  for each row execute function public.touch_updated_at();

comment on table public.geo_neighborhoods is
  'SEO knowledge graph — neighborhoods. See docs/SEO_COLD_START_PLAN.md §4.';

-- ════════════════════════════════════════════════════════════════════
-- market_metrics — provenanced numeric facts (median prices, cost-of-living,
-- demographics, taxes). Polymorphic over the three geo entity types.
-- source_id is NOT NULL → the schema enforces "no number without a source".
-- ════════════════════════════════════════════════════════════════════

create table public.market_metrics (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('country', 'city', 'neighborhood')),
  -- iso2 for country; geo_cities.id / geo_neighborhoods.id (uuid as text) for
  -- the others. Text is the common denominator across the polymorphic target.
  entity_id text not null,
  -- e.g. 'population', 'gdp_per_capita_usd', 'cost_of_living_index',
  -- 'median_sale_price_per_sqm_usd', 'property_transfer_tax_pct'.
  metric text not null check (char_length(metric) between 2 and 80),
  value numeric not null,
  unit text,                              -- 'USD', 'USD/sqm', 'index', 'pct', 'people'
  as_of_date date not null,
  -- HARD RULE: every metric cites a real source. Not nullable on purpose.
  source_id uuid not null references public.data_sources(id),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One value per (entity, metric, date). Re-ingests upsert on this key.
  unique (entity_type, entity_id, metric, as_of_date)
);

create index idx_market_metrics_entity on public.market_metrics(entity_type, entity_id);
create index idx_market_metrics_metric on public.market_metrics(metric, as_of_date desc);

create trigger market_metrics_touch_updated_at
  before update on public.market_metrics
  for each row execute function public.touch_updated_at();

comment on table public.market_metrics is
  'Provenanced numeric facts for the SEO knowledge graph. source_id NOT NULL enforces the data-integrity hard rule (docs/SEO_COLD_START_PLAN.md §6). entity_id is iso2 for countries, uuid-as-text for cities/neighborhoods.';

-- ════════════════════════════════════════════════════════════════════
-- content_guides — generated/edited prose pages (country/city/neighborhood
-- overviews, buying guides, comparisons). Draft until published; only
-- published rows are publicly readable (and thus indexable).
-- ════════════════════════════════════════════════════════════════════

create table public.content_guides (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('country', 'city', 'neighborhood', 'topic', 'comparison')),
  -- The geo entity this guide is about (iso2 / city uuid / neighborhood uuid),
  -- or null for pure topic guides not tied to one place.
  entity_id text,
  locale text not null check (locale in ('en', 'es', 'pl', 'pt', 'de', 'fr', 'it')),
  slug text not null check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 2 and 200),
  -- ≤180 chars keeps it inside the meta-description budget (Lighthouse SEO).
  summary text check (summary is null or char_length(summary) <= 200),
  body_html text,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Sources cited by this guide (for the attribution footer). Array of
  -- data_sources.id; app-level integrity (no per-element FK on arrays).
  source_ids uuid[] not null default '{}',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (locale, slug)
);

create index idx_content_guides_scope on public.content_guides(scope, entity_id);
create index idx_content_guides_published
  on public.content_guides(locale, published_at desc)
  where status = 'published';

create trigger content_guides_touch_updated_at
  before update on public.content_guides
  for each row execute function public.touch_updated_at();

comment on table public.content_guides is
  'Generated/edited SEO prose pages. Only status=published is publicly readable (indexable). See docs/SEO_COLD_START_PLAN.md §4-§5.';

-- ════════════════════════════════════════════════════════════════════
-- data_origin — cheap insurance so the real-vs-synthetic separation EXISTS
-- if Tier 3 is ever used (docs/SEO_COLD_START_PLAN.md §7). Default 'real'
-- → zero behavior change today. The immutability guard blocks laundering a
-- 'seed' row into 'real'.
-- ════════════════════════════════════════════════════════════════════

alter table public.organizations
  add column if not exists data_origin text not null default 'real'
  check (data_origin in ('real', 'seed'));
alter table public.profiles
  add column if not exists data_origin text not null default 'real'
  check (data_origin in ('real', 'seed'));
alter table public.properties
  add column if not exists data_origin text not null default 'real'
  check (data_origin in ('real', 'seed'));

create or replace function public.enforce_data_origin_immutable()
returns trigger
language plpgsql
as $$
begin
  -- One-way door: a row marked 'seed' can never become 'real' (no laundering
  -- synthetic data into the real set). Other transitions are allowed.
  if old.data_origin = 'seed' and new.data_origin is distinct from 'seed' then
    raise exception 'data_origin is immutable for seed rows (attempted seed → %)', new.data_origin;
  end if;
  return new;
end $$;

create trigger organizations_data_origin_guard
  before update on public.organizations
  for each row execute function public.enforce_data_origin_immutable();
create trigger profiles_data_origin_guard
  before update on public.profiles
  for each row execute function public.enforce_data_origin_immutable();
create trigger properties_data_origin_guard
  before update on public.properties
  for each row execute function public.enforce_data_origin_immutable();

comment on column public.properties.data_origin is
  'real (default) | seed. Insurance for the Tier-3 fake-data removal architecture (docs/SEO_COLD_START_PLAN.md §7). Immutable seed→real via enforce_data_origin_immutable().';

-- ════════════════════════════════════════════════════════════════════
-- RLS — public read on reference data; service-role-only writes.
-- ════════════════════════════════════════════════════════════════════

-- Reference tables: anyone may READ (these power public, indexable pages),
-- nobody but service-role may write.
alter table public.data_sources enable row level security;
create policy data_sources_public_read on public.data_sources for select using (true);
revoke insert, update, delete, truncate on public.data_sources from anon, authenticated;

alter table public.geo_countries enable row level security;
create policy geo_countries_public_read on public.geo_countries for select using (true);
revoke insert, update, delete, truncate on public.geo_countries from anon, authenticated;

alter table public.geo_cities enable row level security;
create policy geo_cities_public_read on public.geo_cities for select using (true);
revoke insert, update, delete, truncate on public.geo_cities from anon, authenticated;

alter table public.geo_neighborhoods enable row level security;
create policy geo_neighborhoods_public_read on public.geo_neighborhoods for select using (true);
revoke insert, update, delete, truncate on public.geo_neighborhoods from anon, authenticated;

alter table public.market_metrics enable row level security;
create policy market_metrics_public_read on public.market_metrics for select using (true);
revoke insert, update, delete, truncate on public.market_metrics from anon, authenticated;

-- Guides: public may read ONLY published rows (drafts stay private until
-- ready, so Google never indexes a half-written page). Admins read all.
alter table public.content_guides enable row level security;
create policy content_guides_public_read on public.content_guides
  for select using (status = 'published');
create policy content_guides_admin_read on public.content_guides
  for select to authenticated using (public.is_platform_admin());
revoke insert, update, delete, truncate on public.content_guides from anon, authenticated;
