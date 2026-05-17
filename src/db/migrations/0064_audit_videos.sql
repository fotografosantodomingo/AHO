-- 0064_audit_videos.sql
--
-- Phase 4 of `docs/SUPER_PRO_STAGE_1_PLAN.md` — auto-video engine.
-- Per-audit Reels/TikTok render jobs tracked from enqueue → render →
-- ready → published. One row per (audit, locale) since each market
-- gets its own captioned video.
--
-- Render pipeline (slice 4a + 4b):
--   1. /api/audit/[id]/video POST → insert row with status='queued',
--      enqueue a job on the q.video-gen Cloudflare Queue.
--   2. workers/video-render/ container picks up the job, runs Remotion
--      to render the 9:16 MP4, uploads to R2, sets r2_key + status='ready'.
--   3. UI polls /api/audit/[id]/video GET → renders <video> with the
--      r2_key signed URL.
--
-- Why per-locale rows: per-market visual + per-market caption pairs
-- with a per-market video (US energetic vs DE measured vs IT
-- cinematic). Each row carries its own market dimension so the
-- container picks the right composition variant.
--
-- Access model: public SELECT (preview page reads renders the video
-- inline); service-role writes (Container + API route bypass RLS).
-- claimed_by_user_id is enforced at the API layer when triggering a
-- new render — not via RLS — so the public SELECT here mirrors the
-- ai_audits parent table's pattern.

create table public.audit_videos (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.ai_audits(id) on delete cascade,
  -- 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it' — same dim as
  -- ai_generation_log.market + market-prompts.ts.
  market text not null,
  -- Lifecycle. 'queued' → 'rendering' → 'ready' | 'failed'.
  -- 'failed' rows kept for diagnostics; agent can re-trigger which
  -- inserts a NEW row rather than updating the failed one.
  status text not null default 'queued' check (status in ('queued', 'rendering', 'ready', 'failed')),
  -- R2 object key once the render completes (e.g.
  -- 'audit-videos/<audit_id>/<id>.mp4'). NULL until status='ready'.
  r2_key text,
  -- Final video duration in seconds (target: 15-30s).
  duration_s int,
  -- Renderer-reported error when status='failed'. Categorized like
  -- the publish primitives: 'no_photos' / 'render_timeout' /
  -- 'r2_upload_failed' / 'unknown'.
  error_code text,
  error_message text,
  -- Container render timing (wall clock from job-picked-up to
  -- r2-upload-done). For SLO tracking — target ≤60s per the plan.
  render_ms int,
  created_at timestamptz not null default now(),
  rendered_at timestamptz
);

comment on table public.audit_videos is
  'Per-audit per-market auto-video render jobs. Phase 4 of SUPER_PRO_STAGE_1_PLAN.md.';

create index audit_videos_audit_id_idx on public.audit_videos (audit_id);
create index audit_videos_status_idx on public.audit_videos (status)
  where status in ('queued', 'rendering');
create index audit_videos_created_at_idx on public.audit_videos (created_at desc);

alter table public.audit_videos enable row level security;

-- Public read (mirror of ai_audits — the preview screen is public).
create policy audit_videos_public_select
  on public.audit_videos
  for select
  to public
  using (true);

grant select on public.audit_videos to anon, authenticated;
