-- 0030_merge_anon_recent_views.sql
--
-- Merge anonymous-view history into a user's view history at sign-in.
--
-- Background: `property_recent_views` keys rows by either user_id or
-- anonymous_id (the `aho_anon_id` HTTP-only cookie). When an anon
-- visitor browses 5 properties and then signs in, those 5 views remain
-- under the cookie's anonymous_id and the dashboard / homepage rail
-- shows ZERO recently-viewed for the now-authenticated user — even
-- though the user is in the same browser, same session.
--
-- This function migrates rows from anonymous_id → user_id at sign-in
-- time. Called from the Next.js auth-callback route handler after
-- exchangeCodeForSession / verifyOtp succeeds.
--
-- Conflict handling: if the user has already viewed the same property
-- as an authenticated user, the anon row's viewed_at MIGHT be newer or
-- older. We keep the latest of the two (max(viewed_at)) on the user
-- row, then drop the anon row. The partial-unique indexes from
-- migration 0025 enforce one row per identity per property; this
-- conflict resolution pre-handles the violation that a naive UPDATE
-- would otherwise hit.
--
-- Returns the number of rows that were merged into the user (either
-- promoted from anon, or had their viewed_at updated by a newer anon
-- view). Caller logs if non-zero for observability.

create or replace function public.merge_anon_recent_views(
  p_user_id uuid,
  p_anonymous_id uuid
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  merged_count int;
begin
  if p_user_id is null or p_anonymous_id is null then
    return 0;
  end if;

  -- Step 1: for each anon row that DOESN'T have a corresponding user
  -- row, promote it (set user_id, clear anonymous_id).
  with promoted as (
    update public.property_recent_views r
    set user_id = p_user_id,
        anonymous_id = null
    where r.anonymous_id = p_anonymous_id
      and not exists (
        select 1 from public.property_recent_views u
        where u.user_id = p_user_id
          and u.property_id = r.property_id
      )
    returning r.id
  )
  select count(*)::int into merged_count from promoted;

  -- Step 2: for anon rows where the user ALSO has a row for the same
  -- property, take the latest viewed_at onto the user row, then delete
  -- the anon row. This handles the conflict the partial-unique index
  -- would otherwise raise.
  with conflict_anon as (
    select r.id, r.property_id, r.viewed_at
    from public.property_recent_views r
    where r.anonymous_id = p_anonymous_id
  ),
  update_user as (
    update public.property_recent_views u
    set viewed_at = greatest(u.viewed_at, c.viewed_at)
    from conflict_anon c
    where u.user_id = p_user_id
      and u.property_id = c.property_id
      and c.viewed_at > u.viewed_at
    returning u.id
  ),
  drop_anon as (
    delete from public.property_recent_views r
    where r.anonymous_id = p_anonymous_id
    returning r.id
  )
  select merged_count + (select count(*)::int from update_user) into merged_count;
  -- The drop_anon CTE runs even though we don't read from it (CTEs are
  -- evaluated for side effects in modifying queries).
  perform 1 from drop_anon;

  return merged_count;
end;
$$;

revoke all on function public.merge_anon_recent_views(uuid, uuid) from public;
grant execute on function public.merge_anon_recent_views(uuid, uuid) to authenticated, service_role;

comment on function public.merge_anon_recent_views(uuid, uuid) is
  'Merge a visitor''s anon recent_views (keyed by aho_anon_id cookie) into their user_id at sign-in. Called from /auth/callback. Returns count of rows merged.';
