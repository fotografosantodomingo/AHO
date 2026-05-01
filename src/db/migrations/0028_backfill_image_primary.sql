-- 0028_backfill_image_primary.sql
--
-- Backfill `property_images.is_primary` for existing properties that have
-- images uploaded before the "first image becomes primary" rule was wired
-- (PO directive 2026-05-01).
--
-- Symptom this fixes: listing cards across search / city landings / agent
-- profiles / sitemap-image-children show no thumbnail because every query
-- joins `property_images` with `WHERE is_primary = true` — and no image
-- ever had that flag set. Even though images existed and the gallery
-- showed them on the property detail page, listing cards rendered the
-- placeholder state.
--
-- For each property with at least one confirmed image and zero is_primary
-- rows, promote the lowest-position confirmed image to primary. The
-- `idx_property_one_primary` partial-unique index (created in 0004) keeps
-- the invariant — at most one primary per property.

with first_per_property as (
  select distinct on (pi.property_id)
    pi.id as image_id
  from public.property_images pi
  left join (
    select property_id
    from public.property_images
    where is_primary = true
    group by property_id
  ) primaries on primaries.property_id = pi.property_id
  where pi.upload_status = 'confirmed'
    and primaries.property_id is null
  order by pi.property_id, pi.position asc, pi.created_at asc
)
update public.property_images
set is_primary = true
where id in (select image_id from first_per_property);

-- Sanity: log how many rows were promoted (visible in Supabase logs after
-- the migration runs). No-op if the migration is run a second time
-- because the WHERE filter excludes properties that already have a primary.
do $$
declare
  promoted_count int;
begin
  select count(*) into promoted_count
  from public.property_images
  where is_primary = true;
  raise notice '[0028] property_images is_primary=true count after backfill: %', promoted_count;
end $$;
