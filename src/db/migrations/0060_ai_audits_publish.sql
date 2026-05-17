-- 0060_ai_audits_publish.sql
--
-- Phase 3 of docs/SUPER_PRO_STAGE_1_PLAN.md — approval grid + atomic
-- publish from the /preview/[id] screen. After the agent claims the
-- audit (signup carries ?audit=<id>) and selects which (locale,
-- platform) cells to ship, /api/audit/[id]/publish writes each
-- per-cell outcome here.
--
-- `published_results` shape — array of objects, one per attempted
-- publish:
--   [
--     {
--       "locale": "en",
--       "platform": "facebook",
--       "ok": true,
--       "external_post_id": "1234_5678",
--       "external_post_url": "https://facebook.com/...",
--       "attempted_at": "2026-05-17T20:15:32Z"
--     },
--     {
--       "locale": "es",
--       "platform": "instagram",
--       "ok": false,
--       "error_code": "image_required",
--       "error_message": "Instagram requires at least one imageUrl",
--       "attempted_at": "2026-05-17T20:15:33Z"
--     }
--   ]
--
-- We don't normalize into a new audit_publish_attempts table for v1 —
-- the preview screen is the only reader and array-aggregation in
-- JSONB is fast enough for the expected volume (~10 entries per audit
-- at the absolute upper bound: 3 locales × 3 platforms + retries).
-- If we later add an admin "audit publish history" view across the
-- whole platform, the table normalization becomes worth the cost.

alter table public.ai_audits
  add column if not exists published_results jsonb not null default '[]'::jsonb;

comment on column public.ai_audits.published_results is
  'Per-cell publish outcomes from /api/audit/[id]/publish, JSONB array. Each entry: {locale, platform, ok, external_post_id?, external_post_url?, error_code?, error_message?, attempted_at}. Per docs/SUPER_PRO_STAGE_1_PLAN.md Phase 3.';

-- RLS: existing public_select policy already exposes this column to
-- the preview page (anonymous + authed). No new policy needed;
-- service-role writes via the API route bypass RLS as designed.
