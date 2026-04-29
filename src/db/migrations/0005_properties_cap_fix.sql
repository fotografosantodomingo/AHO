-- 0005_properties_cap_fix.sql
-- Fix the listing-cap enforcement to allow drafts regardless of cap, and to
-- check cap on UPDATE only when transitioning a non-occupying status to a
-- slot-occupying one (active / pending).
--
-- Why this needs a separate migration:
--   - 0004's INSERT policy applied `can_insert_listing` to ALL inserts,
--     including drafts. Drafts are work-in-progress and should never block
--     the cap. RLS test "drafts do not count toward the cap" caught this.
--   - 0004's UPDATE policy ran `can_insert_listing` on every active-row
--     update, but `can_insert_listing` counts ALL active+pending rows
--     including the row being updated, so an agent at cap could not even
--     edit the title of their own listing.
--   - RLS WITH CHECK has no access to OLD row values, so the
--     "non-occupying -> occupying" transition test must live in a trigger.
--
-- Approach:
--   - Recreate `properties_org_insert` to gate cap only when status in
--     ('active', 'pending').
--   - Recreate `properties_org_update` without a cap clause; cap on transition
--     is enforced by a BEFORE UPDATE trigger that sees OLD.status / NEW.status.

-- ============================================================
-- Trigger: enforce cap on status transition
-- ============================================================

create or replace function public.enforce_listing_cap_on_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap int;
  v_count int;
begin
  -- Only check when transitioning from non-occupying to occupying.
  if (old.status in ('active','pending')) or (new.status not in ('active','pending')) then
    return new;
  end if;

  -- Acquire org-scoped advisory lock for atomicity (same pattern as
  -- can_insert_listing).
  perform pg_advisory_xact_lock(hashtextextended(new.org_id::text, 0));

  select listing_cap into v_cap from public.organizations where id = new.org_id;
  if v_cap is null then
    return new; -- unlimited
  end if;

  -- Count current active+pending excluding this row (which has not transitioned yet).
  select count(*) into v_count from public.properties
  where org_id = new.org_id and status in ('active','pending') and id <> new.id;

  if v_count >= v_cap then
    raise exception 'listing_cap_exceeded'
      using errcode = '23514', -- check_violation
            message = format('Org listing cap of %s reached; cannot transition listing to %L.', v_cap, new.status);
  end if;

  return new;
end $$;

drop trigger if exists properties_enforce_cap_on_transition on public.properties;
create trigger properties_enforce_cap_on_transition
  before update on public.properties
  for each row execute function public.enforce_listing_cap_on_transition();

-- ============================================================
-- Replace the INSERT policy: cap only fires for active/pending status.
-- ============================================================

drop policy if exists properties_org_insert on public.properties;
create policy properties_org_insert on public.properties
  for insert
  with check (
    public.get_user_org_role(org_id) in ('owner','manager','agent')
    and (
      status not in ('active','pending')
      or public.can_insert_listing(org_id)
    )
  );

-- ============================================================
-- Replace the UPDATE policy: drop the cap clause from WITH CHECK; the trigger
-- now handles the transition check.
-- ============================================================

drop policy if exists properties_org_update on public.properties;
create policy properties_org_update on public.properties
  for update
  using (
    public.get_user_org_role(org_id) in ('owner','manager','agent')
  )
  with check (
    public.get_user_org_role(org_id) in ('owner','manager','agent')
  );
