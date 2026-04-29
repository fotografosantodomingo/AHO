-- 0006_property_images_upload_status.sql
-- Two-step upload contract for property_images: signed-URL PUT + confirm.
--
-- Flow:
--   1. Agent requests upload → server inserts a `property_images` row with
--      `upload_status = 'pending'`, captures alt text / position / is_primary.
--   2. Server signs an R2 PUT URL scoped to the row's r2_key, returns it.
--   3. Client PUTs the bytes directly to R2.
--   4. Client posts to a confirm endpoint → server flips
--      `upload_status = 'confirmed'`, populates `width` / `height` /
--      `cf_image_id` from the post-confirmation step.
-- Pending rows older than 1 hour without confirmation are swept by a cron.

-- ============================================================
-- Column + sweep index
-- ============================================================

alter table public.property_images
  add column if not exists upload_status text not null default 'pending'
    check (upload_status in ('pending', 'confirmed'));

-- Existing rows in dev/test envs (the fixture image rows from _setup.ts) were
-- inserted before this column existed; default of 'pending' applied to them.
-- The fixture path will start using 'confirmed' explicitly going forward.
-- One-shot: mark all pre-existing rows as confirmed so the public-read RLS
-- below doesn't suddenly hide them.
update public.property_images set upload_status = 'confirmed' where upload_status = 'pending';

-- Index supporting the orphan sweep cron (`pending` rows older than 1 hour).
create index if not exists idx_property_images_pending_sweep
  on public.property_images(created_at)
  where upload_status = 'pending';

-- ============================================================
-- Tighten the unique-primary partial index — only one *confirmed* primary
-- per property. A pending image marked is_primary doesn't block a separate
-- confirmed primary from existing.
-- ============================================================

drop index if exists idx_property_one_primary;
create unique index if not exists idx_property_one_confirmed_primary
  on public.property_images(property_id)
  where is_primary = true and upload_status = 'confirmed';

-- ============================================================
-- Update public-read RLS to require confirmed.
-- Org-member SELECT continues to see both pending and confirmed (agents are
-- managing them and need visibility into the in-progress state).
-- ============================================================

drop policy if exists property_images_public_select on public.property_images;
create policy property_images_public_select on public.property_images
  for select
  using (
    upload_status = 'confirmed'
    and exists (
      select 1 from public.properties p
      where p.id = property_images.property_id
        and p.status = 'active'
        and p.published_at is not null
    )
  );
