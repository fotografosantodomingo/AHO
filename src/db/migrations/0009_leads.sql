-- 0009_leads.sql
-- Leads + helper function for the property detail page's contact UX.
-- See docs/HANDOFF.md §4.4 (leads), §9 (WhatsApp), §17 (contact patterns).
--
-- Lead-creation auth model:
--   - INSERT goes through the service role only (POST /api/leads). Anonymous
--     buyers should be able to send leads, so user-context INSERT would need
--     a permissive policy that opens spam vectors. Routing through the API
--     lets us add Turnstile, rate-limit, content filters before the DB sees
--     the row. No public/user INSERT policy on this table.
--   - SELECT: org members read their org's leads.
--   - UPDATE: org agents/managers/owners update status / notes.
--   - DELETE: admins only.
--
-- The `get_listing_contact()` SECURITY DEFINER function exposes ONLY the
-- listing creator's phone + display name — no other profile fields — so the
-- public detail page can render the WhatsApp button for active+published
-- listings without granting anon read access to the whole `profiles` table.

-- ============================================================
-- leads
-- ============================================================

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  assigned_to uuid references public.profiles(id),
  source text not null check (source in (
    'form', 'phone_click', 'whatsapp_click', 'email_click'
  )),
  contact_name text,
  contact_email citext,
  contact_phone text,
  message text,
  language text default 'en' check (language in ('en','es')),
  user_id uuid references public.profiles(id), -- if the buyer is signed-in
  status text not null default 'new'
    check (status in ('new','contacted','qualified','won','lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_org_status on public.leads(org_id, status);
create index if not exists idx_leads_assigned on public.leads(assigned_to);
create index if not exists idx_leads_property on public.leads(property_id);

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================

alter table public.leads enable row level security;

drop policy if exists leads_org_member_select on public.leads;
create policy leads_org_member_select on public.leads
  for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = leads.org_id and om.user_id = auth.uid()
    )
  );

drop policy if exists leads_org_member_update on public.leads;
create policy leads_org_member_update on public.leads
  for update
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = leads.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager','agent')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members om
      where om.org_id = leads.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager','agent')
    )
  );

drop policy if exists leads_admin_all on public.leads;
create policy leads_admin_all on public.leads
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- (No INSERT policy: writes go through POST /api/leads with the service-role.)

-- ============================================================
-- Helper: get the listing's public-safe contact info
-- ============================================================
--
-- Returns the listing creator's WhatsApp-eligible phone + the org's
-- display name. Hidden when the listing is not active+published.
-- Anon callers reach this via supabase.rpc('get_listing_contact', { p_property_id });
-- the SECURITY DEFINER bypass exposes only the columns we explicitly select.

create or replace function public.get_listing_contact(p_property_id uuid)
returns table(
  agent_full_name text,
  agent_phone text,
  org_id uuid,
  org_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    pf.full_name,
    pf.phone,
    o.id,
    o.name
  from public.properties prop
  join public.profiles pf on pf.id = prop.created_by
  join public.organizations o on o.id = prop.org_id
  where prop.id = p_property_id
    and prop.status = 'active'
    and prop.published_at is not null
$$;

grant execute on function public.get_listing_contact(uuid) to anon, authenticated;
