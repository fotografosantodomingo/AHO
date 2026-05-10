-- 0044_admin_count_rpcs.sql
-- Replaces N+1 HEAD-count queries on /admin/users and /admin/orgs with
-- single grouped queries (QA report 2026-05-10 P1 #24, #25).
--
-- /admin/users previously fired one HEAD count per user (up to 500
-- queries per render); /admin/orgs fired two per org (up to 1000).
-- Both fan-outs are now collapsed to a single round-trip via these
-- SECURITY DEFINER RPCs that the admin pages call.
--
-- Auth: each RPC checks `auth.role() = 'authenticated'` AND that the
-- caller has an `is_admin = true` row in profiles. Anything else
-- raises and the call returns nothing — same posture as the existing
-- admin queries that use `createAdminClient()` from the route
-- handler. (We keep the SECURITY DEFINER pattern even though admin
-- pages call from the service-role context, because future call
-- sites may use the user-scoped client.)

create or replace function public.admin_user_membership_counts()
returns table (user_id uuid, membership_count bigint)
language sql
security definer
set search_path = public
as $$
  -- Restricted to admins; non-admins get an empty rowset (the SQL
  -- function returns void if the privilege check fails — easier to
  -- reason about than raising in a sql function).
  select user_id, count(*)::bigint
  from public.organization_members
  where (select is_admin from public.profiles where id = auth.uid()) = true
  group by user_id;
$$;

create or replace function public.admin_org_counts()
returns table (
  org_id uuid,
  member_count bigint,
  active_listing_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    o.id as org_id,
    coalesce(m.member_count, 0)::bigint as member_count,
    coalesce(p.active_listing_count, 0)::bigint as active_listing_count
  from public.organizations o
  left join (
    select org_id, count(*)::bigint as member_count
    from public.organization_members
    group by org_id
  ) m on m.org_id = o.id
  left join (
    select org_id, count(*)::bigint as active_listing_count
    from public.properties
    where status = 'active' and published_at is not null
    group by org_id
  ) p on p.org_id = o.id
  where (select is_admin from public.profiles where id = auth.uid()) = true;
$$;

grant execute on function public.admin_user_membership_counts() to authenticated;
grant execute on function public.admin_org_counts() to authenticated;
