-- ============================================================
-- 0057_email_audiences
--
-- "Audiences" are admin-uploaded contact lists (CSV import). Used
-- alongside the built-in profiles-derived segments for outbound
-- marketing campaigns. Each audience is a labeled bucket of
-- (name, email, country) rows.
--
-- The send route accepts segment_key in two forms:
--   1. Built-in segments: e.g. `all_subscribers`, `agents_no_pro`
--      → resolved via segment_email_<key>() RPC (migration 0056)
--   2. Audience-backed segments: `audience:<uuid>`
--      → resolved via segment_email_audience(<uuid>) RPC (this file)
--
-- GDPR note: the admin certifies via the upload UI checkbox that the
-- uploaded contacts opted in to marketing from the AHO operator. We
-- don't filter by an opt-in flag on the audience_contacts table since
-- the upload IS the consent record. We DO consult email_unsubscribes
-- on every send, so anyone who clicks Unsubscribe on a campaign is
-- excluded going forward — regardless of which audience they came in
-- via.
-- ============================================================

-- --------------------------------------------------------------
-- email_audiences  — one row per uploaded list
-- --------------------------------------------------------------

create table if not exists public.email_audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  contact_count int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_audiences_created
  on public.email_audiences(created_at desc);

create trigger email_audiences_touch_updated_at
  before update on public.email_audiences
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------
-- email_audience_contacts — one row per imported contact
-- --------------------------------------------------------------

create table if not exists public.email_audience_contacts (
  id uuid primary key default gen_random_uuid(),
  audience_id uuid not null references public.email_audiences(id) on delete cascade,
  email citext not null,
  full_name text,
  country_code text,
  -- Optional structured extras for future use (custom merge vars).
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  -- Dedup: same email can appear in different audiences, but not twice
  -- in the same audience.
  unique (audience_id, email)
);

create index if not exists idx_email_audience_contacts_audience
  on public.email_audience_contacts(audience_id);
create index if not exists idx_email_audience_contacts_email
  on public.email_audience_contacts(email);

-- --------------------------------------------------------------
-- RLS — admin-only
-- --------------------------------------------------------------

alter table public.email_audiences enable row level security;
alter table public.email_audience_contacts enable row level security;

drop policy if exists email_audiences_admin_all on public.email_audiences;
create policy email_audiences_admin_all on public.email_audiences
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists email_audience_contacts_admin_all on public.email_audience_contacts;
create policy email_audience_contacts_admin_all on public.email_audience_contacts
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- --------------------------------------------------------------
-- segment_email_audience(p_audience_id uuid)
--
-- Returns the audience's contacts in the same (email, user_id,
-- full_name) shape as the other segment functions, so the send
-- route's recipient pipeline doesn't need to special-case audiences.
-- Filters against email_unsubscribes (defence in depth — the send
-- route filters too).
--
-- user_id is always null for audiences (these are cold imports;
-- they don't correspond to a profiles row unless they happen to
-- share an email).
-- --------------------------------------------------------------

create or replace function public.segment_email_audience(p_audience_id uuid)
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select c.email, null::uuid as user_id, c.full_name
  from public.email_audience_contacts c
  where c.audience_id = p_audience_id
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = c.email
    );
$$;

revoke all on function public.segment_email_audience(uuid) from public, anon, authenticated;
grant execute on function public.segment_email_audience(uuid) to service_role;
