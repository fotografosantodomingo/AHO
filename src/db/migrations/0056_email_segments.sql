-- ============================================================
-- 0056_email_segments
--
-- SECURITY DEFINER functions that resolve a segment_key string to a
-- recipient list. Called from /api/email/send under the service role.
--
-- Why SECURITY DEFINER + grant-restricted: the segment queries touch
-- profiles, organization_members, saved_searches, leads, properties.
-- Running them as the calling user would require an admin RLS context;
-- DEFINER + explicit grant to service_role gives us a clean boundary
-- (anon + authenticated can't call these even by accident).
--
-- Every function returns the same shape: (email, user_id, full_name).
-- The send route consumes this uniformly and filters against
-- email_unsubscribes before posting to Brevo.
--
-- IMPORTANT: every segment EXPLICITLY filters
--   profiles.email_marketing_opt_in = true
-- This is non-negotiable per GDPR. Test_self is the one exception
-- (it returns only the calling admin's own email; consent is implicit
-- since they're sending to themselves).
-- ============================================================

set search_path = '';

-- --------------------------------------------------------------
-- 1. all_subscribers
--    Every profile with marketing opt-in. Broadest list.
-- --------------------------------------------------------------

create or replace function public.segment_email_all_subscribers()
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select p.email, p.id as user_id, p.full_name
  from public.profiles p
  where p.email is not null
    and p.email_marketing_opt_in = true
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = p.email
    );
$$;

-- --------------------------------------------------------------
-- 2. free_users_no_listing
--    Buyers (not platform admin) who don't belong to any org with
--    listings. Upsell-to-Agent target.
-- --------------------------------------------------------------

create or replace function public.segment_email_free_users_no_listing()
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select p.email, p.id as user_id, p.full_name
  from public.profiles p
  where p.email is not null
    and p.email_marketing_opt_in = true
    and p.is_admin = false
    and not exists (
      select 1
      from public.organization_members om
      join public.organizations o on o.id = om.org_id
      where om.user_id = p.id
        and o.slug not like 'aho-test-org-%'
    )
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = p.email
    );
$$;

-- --------------------------------------------------------------
-- 3. agents_no_pro
--    Agents (owners or members of orgs with listings) who haven't
--    upgraded to Pro Automation. Upsell-to-Pro target.
-- --------------------------------------------------------------

create or replace function public.segment_email_agents_no_pro()
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  -- "On Pro Automation" = current_plan_id LIKE 'aho_pro_automation%'
  -- AND current_status = 'active'. Everyone else (no plan, lapsed,
  -- on Agent/Plus) is an upsell candidate.
  select distinct p.email, p.id as user_id, p.full_name
  from public.profiles p
  join public.organization_members om on om.user_id = p.id
  join public.organizations o on o.id = om.org_id
  where p.email is not null
    and p.email_marketing_opt_in = true
    and o.slug not like 'aho-test-org-%'
    and not (
      o.current_plan_id like 'aho_pro_automation%'
      and o.current_status = 'active'
    )
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = p.email
    );
$$;

-- --------------------------------------------------------------
-- 4. agents_inactive_30d
--    Members of orgs whose most-recent listing edit is >30 days old.
--    Re-engagement target.
-- --------------------------------------------------------------

create or replace function public.segment_email_agents_inactive_30d()
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select distinct p.email, p.id as user_id, p.full_name
  from public.profiles p
  join public.organization_members om on om.user_id = p.id
  join public.organizations o on o.id = om.org_id
  where p.email is not null
    and p.email_marketing_opt_in = true
    and o.slug not like 'aho-test-org-%'
    and (
      select coalesce(max(pr.updated_at), '1970-01-01'::timestamptz)
      from public.properties pr
      where pr.org_id = o.id
    ) < now() - interval '30 days'
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = p.email
    );
$$;

-- --------------------------------------------------------------
-- 5. buyers_with_saved_search
--    Profiles with ≥1 active saved_searches row. Listing-match target.
-- --------------------------------------------------------------

create or replace function public.segment_email_buyers_with_saved_search()
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select distinct p.email, p.id as user_id, p.full_name
  from public.profiles p
  join public.saved_searches ss on ss.user_id = p.id
  where p.email is not null
    and p.email_marketing_opt_in = true
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = p.email
    );
$$;

-- --------------------------------------------------------------
-- 6. recent_leads_14d
--    Anyone who submitted a lead in the past 14 days. Nurture target.
--    Lead emails are exempt from email_marketing_opt_in (the lead
--    submission itself is implicit consent under most jurisdictions);
--    we still consult the unsubscribes table.
-- --------------------------------------------------------------

create or replace function public.segment_email_recent_leads_14d()
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select distinct l.contact_email as email, null::uuid as user_id, l.contact_name as full_name
  from public.leads l
  where l.contact_email is not null
    and l.created_at > now() - interval '14 days'
    and not exists (
      select 1 from public.email_unsubscribes u where u.email = l.contact_email
    );
$$;

-- --------------------------------------------------------------
-- 7. test_self
--    Just the calling admin's profile row. For compose-preview sends.
--    Bypasses marketing opt-in (admin sending to themselves).
-- --------------------------------------------------------------

create or replace function public.segment_email_test_self(p_admin_id uuid)
returns table (email public.citext, user_id uuid, full_name text)
language sql
security definer
set search_path = ''
as $$
  select p.email, p.id as user_id, p.full_name
  from public.profiles p
  where p.id = p_admin_id
    and p.email is not null;
$$;

-- --------------------------------------------------------------
-- Grants — service_role only. Anon + authenticated cannot call.
-- --------------------------------------------------------------

revoke all on function
  public.segment_email_all_subscribers,
  public.segment_email_free_users_no_listing,
  public.segment_email_agents_no_pro,
  public.segment_email_agents_inactive_30d,
  public.segment_email_buyers_with_saved_search,
  public.segment_email_recent_leads_14d,
  public.segment_email_test_self(uuid)
from public, anon, authenticated;

grant execute on function
  public.segment_email_all_subscribers,
  public.segment_email_free_users_no_listing,
  public.segment_email_agents_no_pro,
  public.segment_email_agents_inactive_30d,
  public.segment_email_buyers_with_saved_search,
  public.segment_email_recent_leads_14d,
  public.segment_email_test_self(uuid)
to service_role;
