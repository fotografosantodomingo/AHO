-- 0010_saved_searches.sql
-- User-saved search queries. The buyer side of the marketplace: anyone with
-- an account can save a filter set ("3+ bed apartments in Santo Domingo
-- under $300k") and later receive email alerts when new listings match.
--
-- Per HANDOFF.md §6.4 + CRITIQUE.md "Out of slice 1, into slice 2".
-- Email-alert worker is OUT of scope until Resend wiring lands; this
-- migration sets up the data layer + dashboard view only.
--
-- Schema choice: filter state stored as a JSONB column (`filters`) rather
-- than denormalized columns, because the SearchFilters shape evolves as we
-- add facets (price period, neighborhood, square meters, etc.) and the
-- alert worker reads JSONB once anyway. Keeping it flexible avoids
-- migrations every time we extend the search UI.
--
-- The optional `name` field is user-supplied (nullable; we'll show
-- "Saved on {date}" when name is null).

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text,
  filters jsonb not null,
  -- Locale at the time of save — used to render the alert email in the
  -- right language and to format prices / cities.
  locale text not null default 'en' check (locale in ('en','es')),
  -- Alert delivery state. `notify_email` lets the user opt out per-search
  -- without deleting the search entirely (e.g., they still want to revisit
  -- the filter manually but don't want emails).
  notify_email boolean not null default true,
  -- Timestamp of the most recent listing the alert worker has already
  -- considered for this search. The worker only emails about listings
  -- with `published_at > last_seen_at`, then bumps this forward. Null
  -- on creation; first run treats "now()" as the floor.
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_saved_searches_user on public.saved_searches(user_id);
-- Worker queries by `notify_email = true` + ordered scan; partial index.
create index if not exists idx_saved_searches_alerts
  on public.saved_searches(updated_at)
  where notify_email is true;

create trigger saved_searches_touch_updated_at
  before update on public.saved_searches
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.saved_searches enable row level security;

-- A user reads, inserts, updates, and deletes ONLY their own saved searches.
-- Admins additionally have full access for support / debugging.

drop policy if exists saved_searches_owner_select on public.saved_searches;
create policy saved_searches_owner_select on public.saved_searches
  for select
  using (user_id = auth.uid());

drop policy if exists saved_searches_owner_insert on public.saved_searches;
create policy saved_searches_owner_insert on public.saved_searches
  for insert
  with check (user_id = auth.uid());

drop policy if exists saved_searches_owner_update on public.saved_searches;
create policy saved_searches_owner_update on public.saved_searches
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists saved_searches_owner_delete on public.saved_searches;
create policy saved_searches_owner_delete on public.saved_searches
  for delete
  using (user_id = auth.uid());

drop policy if exists saved_searches_admin_all on public.saved_searches;
create policy saved_searches_admin_all on public.saved_searches
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
