-- 0017_currency_rates.sql
-- Batch A3: currency-rate snapshot for the worldwide price-tile converter.
--
-- Storage shape: one row per base currency, with all conversion rates in
-- a single jsonb. We use USD as the only base in v1 — openexchangerates.org's
-- free tier requires base=USD, and storing one snapshot keeps reads to
-- a single PK lookup. Rates against other bases are derived in the app
-- layer via the cross-rate formula:
--   amount_in_to = (amount_in_from / rates[from]) * rates[to]
--
-- Refresh policy: 24h. The route layer reads the cached row; if
-- `fetched_at < now() - 24h` it triggers a background fetch from OXR
-- (via the service-role admin client) and upserts the row. Concurrent
-- refreshes are race-safe because the upsert is idempotent on the PK.
--
-- Failure mode: if OXR is down AND the cache is stale, we still serve
-- the stale row — the app layer never throws on conversion. Worse to
-- show a wrong-but-close approximate than to break the price tile.

create table if not exists public.currency_rate_snapshot (
  base_currency char(3) primary key,
  -- Map of `{quote_currency: rate_relative_to_base}` — e.g.
  --   {"USD": 1.0, "EUR": 0.92, "DOP": 60.45, "MXN": 17.8, ...}
  rates jsonb not null,
  -- Source provider tag; useful when we add fallbacks (ECB, fixer.io).
  source text not null default 'openexchangerates',
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger currency_rate_snapshot_touch_updated_at
  before update on public.currency_rate_snapshot
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.currency_rate_snapshot enable row level security;

-- Public read: rates are public information (no privacy risk; OXR's
-- free tier is sub-licensed for this kind of redistribution per their
-- terms — verify if we move to paid tier).
drop policy if exists currency_rate_snapshot_public_select on public.currency_rate_snapshot;
create policy currency_rate_snapshot_public_select on public.currency_rate_snapshot
  for select
  to anon, authenticated
  using (true);

-- No INSERT / UPDATE / DELETE policies → service-role only. The route
-- layer's refresh path uses the admin client to upsert.
