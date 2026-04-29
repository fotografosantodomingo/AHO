-- 0004_properties.sql
-- Properties + property_images. See docs/HANDOFF.md §4.3, §4.7, §8.
-- Listing-cap race fix per docs/CRITIQUE.md §B4 (advisory lock inside the RLS
-- WITH CHECK function). Public-read pattern: simple RLS policy `status='active'
-- AND published_at IS NOT NULL` for anon reads. Address-masking by
-- `display_address=false` is currently a SSR concern; revisit as a view in
-- v1.5 if anon-direct-REST exposure becomes a problem.

-- ============================================================
-- Helper: short ID generator for SEO-friendly URLs.
-- 6-char base62 (62^6 ~= 57 billion). Unique constraint catches rare collisions.
-- ============================================================

create or replace function public.gen_short_id()
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  result text := '';
  i int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + (random() * 61)::int, 1);
  end loop;
  return result;
end $$;

-- ============================================================
-- properties
-- ============================================================

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  short_id text not null unique default public.gen_short_id(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  created_by uuid not null references public.profiles(id),

  -- Listing intent
  transaction_type text not null check (transaction_type in ('sale','rent','short_term')),
  property_type text not null,
  status text not null default 'draft' check (status in (
    'draft','active','pending','sold','rented','archived'
  )),

  -- Localized content (single-language listings allowed per
  -- DECISIONS.md "Drop the no-language-fallback rule")
  title_en text,
  title_es text,
  description_en text,
  description_es text,
  slug_en text,
  slug_es text,

  -- Numbers
  price_cents bigint not null check (price_cents >= 0),
  currency char(3) not null,
  price_period text check (price_period in ('total','monthly','weekly','nightly')),
  bedrooms int check (bedrooms is null or bedrooms >= 0),
  bathrooms numeric(3,1) check (bathrooms is null or bathrooms >= 0),
  area_sqm numeric(10,2) check (area_sqm is null or area_sqm > 0),
  lot_size_sqm numeric(12,2) check (lot_size_sqm is null or lot_size_sqm > 0),
  year_built int check (year_built is null or (year_built between 1700 and 2100)),

  -- Address (split for SEO + privacy controls)
  address_line text,
  neighborhood text,
  city text not null,
  state_region text,
  country_code char(2) not null,
  postal_code text,
  display_address boolean not null default true,

  -- Geo (PostGIS)
  location geography(Point, 4326) not null,

  -- Features
  amenities text[] not null default '{}',
  features jsonb not null default '{}'::jsonb,

  -- Featured / promotion
  featured_until timestamptz,

  -- SEO computed fields cached for fast SSR
  seo_title_en text,
  seo_title_es text,
  seo_description_en text,
  seo_description_es text,

  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Title is required in at least one language for any non-draft status.
  -- Drafts can be saved with empty fields.
  check (
    status = 'draft'
    or coalesce(length(trim(title_en)), 0) > 0
    or coalesce(length(trim(title_es)), 0) > 0
  ),

  -- A published listing must have a slug in at least the language(s) it has a title in.
  check (
    status not in ('active','pending','sold','rented')
    or (
      (title_en is null or coalesce(length(trim(slug_en)), 0) > 0)
      and (title_es is null or coalesce(length(trim(slug_es)), 0) > 0)
    )
  ),

  -- published_at consistency: set when status moved to public state, null on draft.
  check (
    (status in ('active','pending','sold','rented') and published_at is not null)
    or (status in ('draft','archived'))
  )
);

-- Indexes per HANDOFF §4.3
create index if not exists idx_properties_status on public.properties(status);
create index if not exists idx_properties_org on public.properties(org_id);
create index if not exists idx_properties_location on public.properties using gist(location);
create index if not exists idx_properties_country_city on public.properties(country_code, city);
create index if not exists idx_properties_price on public.properties(price_cents) where status = 'active';
-- `now()` cannot appear in an index predicate (PostgreSQL requires IMMUTABLE).
-- Partial index on `featured_until is not null` still serves the `> now()` query.
create index if not exists idx_properties_featured on public.properties(featured_until) where featured_until is not null;
create index if not exists idx_properties_published on public.properties(published_at desc) where status = 'active' and published_at is not null;
create index if not exists idx_properties_search_en on public.properties using gin(to_tsvector('english', coalesce(title_en,'') || ' ' || coalesce(description_en,'')));
create index if not exists idx_properties_search_es on public.properties using gin(to_tsvector('spanish', coalesce(title_es,'') || ' ' || coalesce(description_es,'')));

create trigger properties_touch_updated_at
  before update on public.properties
  for each row execute function public.touch_updated_at();

-- ============================================================
-- property_images
-- ============================================================

create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  r2_key text not null,
  cf_image_id text,
  alt_text_en text,
  alt_text_es text,
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  position int not null default 0 check (position >= 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_images_property on public.property_images(property_id, position);
-- Only one primary image per property
create unique index if not exists idx_property_one_primary
  on public.property_images(property_id) where is_primary = true;

-- ============================================================
-- Cap enforcement helper.
-- Per CRITIQUE.md §B4: take an xact-level advisory lock keyed on org_id, then
-- count + cap-check inside the lock. The lock auto-releases at end of
-- transaction so the next caller blocks until the row commits or rolls back.
-- This makes "the 6th INSERT for an Agent on a 5-cap plan" deterministically
-- fail rather than racing.
--
-- Hash chosen: hashtextextended(org_id::text, 0) — 64-bit hash of the UUID
-- string, deterministic per org.
-- ============================================================

create or replace function public.can_insert_listing(p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_count int;
begin
  -- Take xact-level advisory lock for this org. Auto-releases on transaction end.
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text, 0));

  -- Cap = null means unlimited (Expert tier).
  select listing_cap into v_cap from public.organizations where id = p_org_id;
  if v_cap is null then
    return true;
  end if;

  -- Count statuses that occupy a slot. 'draft' and 'archived' do not.
  -- 'sold' / 'rented' free up slots once an agent marks them.
  select count(*) into v_count from public.properties
  where org_id = p_org_id and status in ('active','pending');

  return v_count < v_cap;
end $$;

-- ============================================================
-- RLS
-- ============================================================

alter table public.properties enable row level security;
alter table public.property_images enable row level security;

-- ----- properties: SELECT --------------------------------------------------

-- Anonymous + authenticated can read active+published listings.
-- Address-line privacy (`display_address=false`) is currently a SSR concern;
-- a future view-based masking lands in v1.5 if anon-direct-REST exposure
-- becomes a problem.
drop policy if exists properties_public_select on public.properties;
create policy properties_public_select on public.properties
  for select
  using (status = 'active' and published_at is not null);

-- Org members read all of their org's listings (drafts, pending, archived, etc.).
drop policy if exists properties_org_member_select on public.properties;
create policy properties_org_member_select on public.properties
  for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = properties.org_id and om.user_id = auth.uid()
    )
  );

drop policy if exists properties_admin_select on public.properties;
create policy properties_admin_select on public.properties
  for select
  using (public.is_platform_admin());

-- ----- properties: INSERT --------------------------------------------------

-- Org members with role agent / manager / owner can insert listings into
-- their own org, **subject to the listing cap** (race-safe via advisory lock).
drop policy if exists properties_org_insert on public.properties;
create policy properties_org_insert on public.properties
  for insert
  with check (
    public.get_user_org_role(org_id) in ('owner','manager','agent')
    and public.can_insert_listing(org_id)
  );

drop policy if exists properties_admin_insert on public.properties;
create policy properties_admin_insert on public.properties
  for insert
  with check (public.is_platform_admin());

-- ----- properties: UPDATE --------------------------------------------------

-- Org members with role agent / manager / owner can update their org's listings.
-- Cap re-check on UPDATE: if a draft is being moved to status='active', re-check
-- the cap. The check function is the same — it counts current active+pending
-- excluding-the-row-being-updated… but since UPDATE doesn't add to count, the
-- count is correct as-is when current row is already active/pending. When
-- transitioning draft -> active, the count is the *current* active+pending which
-- doesn't include this row yet, so the check is correct.
--
-- Edge case: if the agent flips status from sold -> active for a relisting and
-- the org is at cap with other active listings, the check will fail. Intended.
drop policy if exists properties_org_update on public.properties;
create policy properties_org_update on public.properties
  for update
  using (
    public.get_user_org_role(org_id) in ('owner','manager','agent')
  )
  with check (
    public.get_user_org_role(org_id) in ('owner','manager','agent')
    and (
      -- Allow: status not changing to a slot-occupying state, OR cap allows it.
      status not in ('active','pending')
      or public.can_insert_listing(org_id)
    )
  );

drop policy if exists properties_admin_update on public.properties;
create policy properties_admin_update on public.properties
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ----- properties: DELETE --------------------------------------------------

-- Hard-delete restricted to org owners. Standard practice is `status='archived'`
-- via UPDATE. Hard-delete is for moderation cleanup or compliance (GDPR).
drop policy if exists properties_org_delete on public.properties;
create policy properties_org_delete on public.properties
  for delete
  using (public.get_user_org_role(org_id) = 'owner');

drop policy if exists properties_admin_delete on public.properties;
create policy properties_admin_delete on public.properties
  for delete
  using (public.is_platform_admin());

-- ----- property_images: SELECT --------------------------------------------

-- Public can see images of active+published properties.
drop policy if exists property_images_public_select on public.property_images;
create policy property_images_public_select on public.property_images
  for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_images.property_id
        and p.status = 'active'
        and p.published_at is not null
    )
  );

-- Org members can see images of all their org's properties.
drop policy if exists property_images_org_member_select on public.property_images;
create policy property_images_org_member_select on public.property_images
  for select
  using (
    exists (
      select 1 from public.properties p
      join public.organization_members om on om.org_id = p.org_id
      where p.id = property_images.property_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists property_images_admin_all on public.property_images;
create policy property_images_admin_all on public.property_images
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ----- property_images: INSERT / UPDATE / DELETE --------------------------

-- Org agents+ can write images for their org's properties.
drop policy if exists property_images_org_insert on public.property_images;
create policy property_images_org_insert on public.property_images
  for insert
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  );

drop policy if exists property_images_org_update on public.property_images;
create policy property_images_org_update on public.property_images
  for update
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  );

drop policy if exists property_images_org_delete on public.property_images;
create policy property_images_org_delete on public.property_images
  for delete
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  );
