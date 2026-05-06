-- 0029_passive_pending_image_sweep.sql
--
-- Passive cleanup for stale pending-image rows.
--
-- Background: every property-image upload is a 2-step flow (insert pending
-- row → presigned R2 PUT → confirm). If the client drops the connection,
-- the user closes the tab, or the network blips between steps 2 and 3,
-- the `property_images` row is left at `upload_status='pending'` forever.
-- These pending rows count toward the 30-image-per-property cap (per
-- `checkImageCap()` which selects all rows regardless of status), so an
-- agent who's bounced a few uploads off network errors can find
-- themselves locked out of new uploads with no visible photos to delete.
--
-- This migration adds `sweep_stale_pending_images(p_property_id, p_older_than_minutes)`
-- — a SECURITY DEFINER function that deletes pending rows older than N
-- minutes for a given property. The upload POST handler calls it at the
-- start of every new upload (before the cap check), passing 60 minutes
-- as the threshold. Bounded scope (one property at a time), naturally
-- rate-limited (only runs when an agent uploads), zero new infra.
--
-- Why SECURITY DEFINER: the upload POST handler runs as the user-context
-- client; deletes go through RLS, which DOES allow org-member roles to
-- delete their own org's images via `property_images_org_member_*`
-- policies. But routing through a SECURITY DEFINER function (a) gives us
-- a single chokepoint we can later wire to a Cloudflare Cron without
-- changing the call sites, and (b) skips the per-row RLS check overhead
-- that an explicit `delete from property_images where ... and exists(...)`
-- pattern would carry.
--
-- Returns the number of rows deleted, so the caller can log if needed.

create or replace function public.sweep_stale_pending_images(
  p_property_id uuid,
  p_older_than_minutes int default 60
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count int;
begin
  if p_property_id is null then
    return 0;
  end if;
  if p_older_than_minutes is null or p_older_than_minutes < 1 then
    p_older_than_minutes := 60;
  end if;

  with d as (
    delete from public.property_images
    where property_id = p_property_id
      and upload_status = 'pending'
      and created_at < now() - (p_older_than_minutes || ' minutes')::interval
    returning id
  )
  select count(*)::int into deleted_count from d;

  return deleted_count;
end;
$$;

revoke all on function public.sweep_stale_pending_images(uuid, int) from public;
grant execute on function public.sweep_stale_pending_images(uuid, int) to authenticated, service_role;

comment on function public.sweep_stale_pending_images(uuid, int) is
  'Delete pending property_images rows older than the threshold for a single property. Called passively by the upload POST handler before the cap check. Returns count of rows deleted.';
