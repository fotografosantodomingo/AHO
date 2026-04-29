-- 0002_identity.sql
-- Identity tables: profiles (extends auth.users), organizations, organization_members.
-- See docs/HANDOFF.md §4.1 for the canonical schema and §4.7 for the RLS pattern.
-- Tier-resolution helpers live here; per docs/CRITIQUE.md §B7, tier comparison
-- is split into two functions instead of the single ordered tier of spec §4.8.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text,
  phone text,
  avatar_url text,
  preferred_language text not null default 'en'
    check (preferred_language in ('en','es')),
  preferred_currency char(3) not null default 'USD',
  preferred_theme text not null default 'system'
    check (preferred_theme in ('light','dark','system')),
  country_code char(2),
  city text,
  marketing_opt_in boolean not null default false,
  is_admin boolean not null default false,
  admin_role text
    check (admin_role in (
      'super_admin','billing_admin','user_support','content_admin','analytics_viewer'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  type text not null check (type in ('agent','agency','expert')),
  logo_url text,
  website text,
  description_en text,
  description_es text,
  headquarters_country char(2),
  headquarters_city text,
  seats_total int not null default 1,
  listing_cap int,                              -- null = unlimited (Expert)
  rank_boost numeric(3,2) not null default 0.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function public.touch_updated_at();

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','manager','agent','analyst','viewer')),
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  primary key (org_id, user_id)
);

create index if not exists idx_org_members_user on public.organization_members(user_id);

-- ============================================================
-- Auto-create a profile row when a new auth.users row is inserted
-- ============================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============================================================
-- Protect admin fields against user-context updates.
-- The service-role key bypasses this trigger via the role check; user-context
-- updates have their is_admin / admin_role fields restored to the old values.
-- This is the belt to RLS's suspenders against R7 (CRITIQUE §B7 / RISKS R7).
-- ============================================================

create or replace function public.protect_profile_admin_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (auth.jwt() ->> 'role') = 'service_role' then
    return new;
  end if;
  new.is_admin := old.is_admin;
  new.admin_role := old.admin_role;
  return new;
end $$;

drop trigger if exists profiles_protect_admin_fields on public.profiles;
create trigger profiles_protect_admin_fields
  before update on public.profiles
  for each row execute function public.protect_profile_admin_fields();

-- ============================================================
-- Tier-resolution helpers
-- Per docs/CRITIQUE.md §B7: split into orthogonal capability functions
-- rather than a single ordered tier. Buyer tier and org role compose at the
-- caller; they don't collapse to one rank.
-- ============================================================

-- Returns 'free' (no auth) or 'registered' (signed-in user).
-- 'premium' will be added in v1.1 when the Premium buyer tier ships.
create or replace function public.get_user_buyer_tier(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when uid is null then 'free' else 'registered' end;
$$;

-- Returns the role of the user in the given org, or null if not a member.
create or replace function public.get_user_org_role(p_org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.organization_members
  where org_id = p_org_id and user_id = auth.uid()
  limit 1;
$$;

-- Convenience: is the current user a platform admin?
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- ----- profiles --------------------------------------------------------

-- A user can read their own profile.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select
  using (id = auth.uid());

-- A user can update their own profile.
-- Admin fields are filtered by the protect_profile_admin_fields trigger,
-- so allowing the row through is safe.
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- Platform admins can read all profiles.
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select
  using (public.is_platform_admin());

-- Platform admins can update profiles. The protect trigger still resets
-- admin fields on user-context updates; admins coming through the dashboard
-- use the service-role for admin-field writes.
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ----- organizations ---------------------------------------------------

-- Org members can read their own org.
drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations
  for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = id and om.user_id = auth.uid()
    )
  );

-- Org owners + managers can update their own org.
drop policy if exists organizations_admin_update on public.organizations;
create policy organizations_admin_update on public.organizations
  for update
  using (public.get_user_org_role(id) in ('owner','manager'))
  with check (public.get_user_org_role(id) in ('owner','manager'));

-- Platform admins read/manage all orgs.
drop policy if exists organizations_platform_admin_all on public.organizations;
create policy organizations_platform_admin_all on public.organizations
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- (No public/user-context insert policy: organizations are created by the
-- Stripe checkout webhook handler running with the service-role key.)

-- ----- organization_members --------------------------------------------

-- A user can see their own memberships.
drop policy if exists om_self_select on public.organization_members;
create policy om_self_select on public.organization_members
  for select
  using (user_id = auth.uid());

-- Org owners and managers can see all members of their org.
drop policy if exists om_org_admin_select on public.organization_members;
create policy om_org_admin_select on public.organization_members
  for select
  using (public.get_user_org_role(org_id) in ('owner','manager'));

-- Org owners can insert/update/delete members.
drop policy if exists om_owner_insert on public.organization_members;
create policy om_owner_insert on public.organization_members
  for insert
  with check (public.get_user_org_role(org_id) = 'owner');

drop policy if exists om_owner_update on public.organization_members;
create policy om_owner_update on public.organization_members
  for update
  using (public.get_user_org_role(org_id) = 'owner')
  with check (public.get_user_org_role(org_id) = 'owner');

drop policy if exists om_owner_delete on public.organization_members;
create policy om_owner_delete on public.organization_members
  for delete
  using (public.get_user_org_role(org_id) = 'owner');

-- Platform admins.
drop policy if exists om_platform_admin_all on public.organization_members;
create policy om_platform_admin_all on public.organization_members
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
