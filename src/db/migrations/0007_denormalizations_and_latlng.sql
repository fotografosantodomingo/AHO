-- 0007_denormalizations_and_latlng.sql
--
-- Three independent fixes addressed in one migration:
--
--   1. `properties.image_count` denormalized column with a CHECK constraint
--      and a trigger on `property_images` INSERT/DELETE — closes the gap where
--      a future route could blow past the 30-image cap because the previous
--      enforcement was route-only (no DB-side backstop).
--
--   2. `properties.latitude` / `properties.longitude` plain columns maintained
--      by a `BEFORE INSERT OR UPDATE OF location` trigger — needed for the
--      JSON-LD geo block and the future map view. Generated columns don't
--      work for this because PostGIS `ST_Y` / `ST_X` aren't marked IMMUTABLE
--      (rejected by Postgres for STORED GENERATED expressions).
--
--   3. Entitlement denormalization on `organizations` (`current_subscription_id`,
--      `current_plan_id`, `current_status`, `current_period_end`) maintained
--      by a trigger on `subscriptions` INSERT/UPDATE/DELETE — eliminates the
--      authz-time join through `subscriptions` while preserving the full
--      subscription history table for audit and reporting.

-- ============================================================
-- 1. property image count denormalization
-- ============================================================

alter table public.properties
  add column if not exists image_count int not null default 0
    check (image_count >= 0 and image_count <= 30);

-- Backfill existing rows (fixture rows from RLS tests).
update public.properties p
set image_count = (
  select count(*) from public.property_images i where i.property_id = p.id
);

create or replace function public.update_property_image_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.properties
      set image_count = image_count + 1
      where id = new.property_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.properties
      set image_count = greatest(image_count - 1, 0)
      where id = old.property_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists property_images_maintain_count on public.property_images;
create trigger property_images_maintain_count
  after insert or delete on public.property_images
  for each row execute function public.update_property_image_count();

-- ============================================================
-- 2. lat/lng on properties
-- ============================================================

alter table public.properties
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create or replace function public.set_property_latlng()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.latitude := ST_Y(new.location::geometry);
  new.longitude := ST_X(new.location::geometry);
  return new;
end $$;

drop trigger if exists properties_set_latlng on public.properties;
create trigger properties_set_latlng
  before insert or update of location on public.properties
  for each row execute function public.set_property_latlng();

-- Backfill existing rows.
update public.properties
  set latitude = ST_Y(location::geometry),
      longitude = ST_X(location::geometry);

-- Indexes for queries by bounding box (cheaper than the full GIST in some cases
-- and useful for lat-only sorts).
create index if not exists idx_properties_latitude on public.properties(latitude);
create index if not exists idx_properties_longitude on public.properties(longitude);

-- ============================================================
-- 3. Entitlement denormalization on organizations
-- ============================================================

alter table public.organizations
  add column if not exists current_subscription_id uuid
    references public.subscriptions(id) on delete set null,
  add column if not exists current_plan_id text
    references public.plans(id) on delete set null,
  add column if not exists current_status text,
  add column if not exists current_period_end timestamptz;

-- Index for queries that filter by status (e.g., admin lists of past_due orgs).
create index if not exists idx_organizations_current_status
  on public.organizations(current_status)
  where current_status is not null;

-- Compute the "best" subscription for an org and write it onto the row.
-- Best = highest-priority active state, then most recent period_end.
-- Statuses ordered: active > trialing > past_due > incomplete > suspended >
-- cancelled > expired. (`cancelled` outranks `expired` because cancelled
-- still has access until period_end; expired means dunning ran out.)
create or replace function public.recompute_org_current_subscription(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id uuid;
  v_plan_id text;
  v_status text;
  v_period_end timestamptz;
begin
  select s.id, s.plan_id, s.status, s.current_period_end
    into v_sub_id, v_plan_id, v_status, v_period_end
  from public.subscriptions s
  where s.org_id = p_org_id
  order by
    case s.status
      when 'active' then 1
      when 'trialing' then 2
      when 'past_due' then 3
      when 'incomplete' then 4
      when 'suspended' then 5
      when 'cancelled' then 6
      when 'expired' then 7
      else 8
    end,
    s.current_period_end desc nulls last
  limit 1;

  -- v_sub_id is null when the org has no subscription rows; clear the denorm.
  update public.organizations
    set current_subscription_id = v_sub_id,
        current_plan_id = v_plan_id,
        current_status = v_status,
        current_period_end = v_period_end
    where id = p_org_id;
end $$;

create or replace function public.refresh_org_current_subscription_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recompute_org_current_subscription(new.org_id);
  elsif tg_op = 'UPDATE' then
    perform public.recompute_org_current_subscription(new.org_id);
    -- Rare: subscription moved to a different org. Recompute the old one too.
    if new.org_id is distinct from old.org_id then
      perform public.recompute_org_current_subscription(old.org_id);
    end if;
  elsif tg_op = 'DELETE' then
    perform public.recompute_org_current_subscription(old.org_id);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists subscriptions_refresh_org_current on public.subscriptions;
create trigger subscriptions_refresh_org_current
  after insert or update or delete on public.subscriptions
  for each row execute function public.refresh_org_current_subscription_trigger();

-- Backfill from existing subscriptions (the fixture sub from RLS tests).
do $$
declare
  v_org_id uuid;
begin
  for v_org_id in select distinct org_id from public.subscriptions where org_id is not null
  loop
    perform public.recompute_org_current_subscription(v_org_id);
  end loop;
end $$;
