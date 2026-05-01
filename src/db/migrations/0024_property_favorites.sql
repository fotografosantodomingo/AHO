-- 0024_property_favorites.sql
-- feat/favorites — buyer-side saved properties.
--
-- Buyers tap a heart on a listing card or property detail page to save
-- the listing to their personal collection. Backed by a tiny join table:
-- one row per (user, property) pair.
--
-- Anonymous users see the heart but a click redirects them to /signin —
-- there's no anon path here, so RLS has no anon policy at all.
--
-- Cascades: a user account deletion (CASCADE from profiles, see
-- migration 0023) removes their favorites; a property deletion removes
-- the favorites pointing at it. No orphans.

create table if not exists public.property_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, property_id)
);

create index if not exists idx_property_favorites_user
  on public.property_favorites(user_id, created_at desc);

create index if not exists idx_property_favorites_property
  on public.property_favorites(property_id);

alter table public.property_favorites enable row level security;

-- SELECT: user reads their own favorites; admins read all.
create policy property_favorites_self_select
  on public.property_favorites for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy property_favorites_admin_select
  on public.property_favorites for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

-- INSERT: user can only insert favorites with their own user_id.
-- Anon has no policy → anon INSERTs are denied at the policy layer.
create policy property_favorites_self_insert
  on public.property_favorites for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- DELETE: user can only remove their own favorites; admins can remove any
-- (for moderation, e.g. removing favorites that were created via abuse).
create policy property_favorites_self_delete
  on public.property_favorites for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy property_favorites_admin_delete
  on public.property_favorites for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

-- No UPDATE policies — favorites are toggle-only (insert-or-delete).
