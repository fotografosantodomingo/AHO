-- 0025_property_recent_views.sql
-- feat/recently-viewed — track which properties a visitor (anon or authed)
-- has looked at, so we can render a "Recently viewed" rail on
-- homepage + (later) /search empty state.
--
-- Identity model:
--   - Authenticated user → user_id = auth.users.id (cross-device).
--   - Anonymous visitor  → anonymous_id = a UUID stored in the
--     `aho_anon_id` HTTP-only cookie set by the view-tracker route.
--     Per-browser persistence; resets on cookie clear.
--   - At least one of (user_id, anonymous_id) MUST be non-null
--     (CHECK constraint).
--
-- Writes are SERVER-MEDIATED via the admin client through
-- POST /api/properties/[id]/view. RLS therefore has no INSERT/UPDATE
-- policies — direct PostgREST writes are denied for both anon and
-- authenticated tiers (service-role bypasses).
--
-- Reads (rail rendering on homepage etc.) also go through the admin
-- client server-side, which reads the cookie + session and queries
-- by user_id OR anonymous_id. RLS policies for SELECT are kept
-- minimal: a user-context owner-self policy lets a future "/dashboard
-- /history" client-side fetch work without service-role; admin reads
-- everything for moderation. Anon SELECT has no policy (server-mediated
-- only).
--
-- Dedup: partial unique indexes on (user_id, property_id) and
-- (anonymous_id, property_id) so re-viewing the same property is an
-- UPSERT (refreshing viewed_at), not a row explosion. The rail then
-- queries DISTINCT ON the visitor key, ordered by viewed_at desc.

create table if not exists public.property_recent_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  anonymous_id uuid,
  property_id uuid not null references public.properties(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  -- Locale at view-time. Useful for future per-locale "popular this week"
  -- aggregates without joining to source URL.
  locale text not null check (locale in ('en','es')),
  -- Optional: where the visitor came FROM (referrer-style, not actual
  -- HTTP referer header). E.g. '/en/search?city=...'. Best-effort.
  source_path text,
  -- Identity invariant: an anon view sets anonymous_id, an authed view
  -- sets user_id. A view recorded mid-signup edge case may set both.
  constraint property_recent_views_identity_present
    check (user_id is not null or anonymous_id is not null)
);

-- Per-visitor uniqueness (UPSERT target). Two partial uniques covering
-- the two visitor types — postgres can't do `unique(coalesce(...))`.
create unique index if not exists property_recent_views_user_property_uniq
  on public.property_recent_views(user_id, property_id)
  where user_id is not null;

create unique index if not exists property_recent_views_anon_property_uniq
  on public.property_recent_views(anonymous_id, property_id)
  where anonymous_id is not null;

-- Read indexes: ordered fetches by visitor key, scanning newest-first.
create index if not exists idx_recent_views_user_time
  on public.property_recent_views(user_id, viewed_at desc)
  where user_id is not null;

create index if not exists idx_recent_views_anon_time
  on public.property_recent_views(anonymous_id, viewed_at desc)
  where anonymous_id is not null;

-- Future analytics support (per-property view recency).
create index if not exists idx_recent_views_property_time
  on public.property_recent_views(property_id, viewed_at desc);

alter table public.property_recent_views enable row level security;

-- SELECT: owner reads own (for any future client-side history view);
-- admin reads everything. No anon policy — anon paths go through the
-- service role.
create policy property_recent_views_self_select
  on public.property_recent_views for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy property_recent_views_admin_select
  on public.property_recent_views for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

-- DELETE: user can clear own (for a future "Clear recently viewed" UI);
-- admin can delete any. Service-role bypasses.
create policy property_recent_views_self_delete
  on public.property_recent_views for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy property_recent_views_admin_delete
  on public.property_recent_views for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

-- No INSERT / UPDATE policies — service-role only via the API route.
