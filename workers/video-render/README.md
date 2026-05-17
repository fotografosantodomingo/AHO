# aho-video-render — Cloudflare Containers worker (Phase 4 slice 4b)

> **Status: SCAFFOLD ONLY.** Files in this directory document the
> intended shape; no actual container/render code is committed yet.
> See "What ships in slice 4b" below.

## What this directory will become

A Cloudflare Containers Worker that renders 15-30s vertical 9:16 Reel/TikTok videos for AHO's Free Audit pipeline.

**Flow:**

1. `/api/audit/[id]/video` POST inserts an `audit_videos` row with `status='queued'` and enqueues a job on the `q.video-gen` Cloudflare Queue.
2. This worker's queue consumer picks up the job, calls into the Container HTTP endpoint with the audit's `VideoScript` spec.
3. The Container (Node + Remotion + ffmpeg) renders the MP4, uploads to R2 under `audit-videos/<audit_id>/<job_id>.mp4`.
4. Worker writes `r2_key` + `status='ready'` (or `failed` + `error_*`) back via the Supabase admin client.
5. UI polls `/api/audit/[id]/video` GET and renders the `<video>` once `status === 'ready'`.

## What's already shipped (slice 4a — committed)

- `src/db/migrations/0064_audit_videos.sql` — `audit_videos` table with status/r2_key/error_code columns + public-read RLS
- `src/lib/creative/video-script.ts` — pure function `buildVideoScript({facts, market, locale})` → Remotion props (composition id, dimensions, photos with Ken-Burns cues, per-market color palette via `creative/styles.ts`, per-market CTA)
- `src/app/api/audit/[id]/video/route.ts` — POST enqueues row, GET polls; returns `pending: true, hint: 'Render container deploys in slice 4b'` for now
- This README documenting the missing pieces

## What ships in slice 4b (next multi-day session)

In this directory:

- `Dockerfile` — base on `node:20-bookworm-slim`, install `ffmpeg`, `npm i @remotion/cli @remotion/renderer`, copy the composition source, expose an HTTP server on $PORT.
- `src/composition.tsx` — Remotion JSX for the `reel-real-estate-v1` composition: `<TitleCard>` → `<KenBurnsSequence photos={...}>` → `<PriceCard>`.
- `src/server.ts` — Hono/Express HTTP server exposing `POST /render` that takes a `VideoScript`, invokes Remotion's `renderMedia()`, uploads MP4 to R2 via S3-compatible API, returns the R2 key.
- `wrangler.toml` — Cloudflare Containers binding pointing at the deployed image, queue consumer config (`q.video-gen`), R2 bucket binding, env secrets (`SUPABASE_SERVICE_ROLE_KEY`, `AHO_R2_ACCESS_KEY`, etc.).
- `src/index.ts` — Worker entry: queue consumer that hydrates the audit, builds the `VideoScript` via the shared `buildVideoScript()` helper, calls the Container, writes the result back to `audit_videos`.

## Pre-requisites for the slice 4b session

These need to land before container code can be wired:

- [ ] PO confirms music-library decision (`docs/PO_DECISIONS.md` #4 — Pixabay free vs Epidemic Sound $50/mo). Slice 4b ships without music if undecided; music gets added in 4.1.
- [ ] PO opens Cloudflare Containers in the account (Workers paid plan + Containers beta enrollment if still gated).
- [ ] PO creates R2 bucket `aho-audit-videos` (or similar) — name set in `wrangler.toml`.
- [ ] PO creates a Cloudflare Queue `q.video-gen`.
- [ ] First Container image build + push (`wrangler deploy` from this directory after Dockerfile lands).

## Cost model (per `docs/PO_DECISIONS.md` #1 = Option A locked 2026-05-17)

- ~$0.05 per video render (Cloudflare Containers compute)
- ~$0.0001 per video stored (R2)
- Plays via R2 + custom domain → free egress

At 50 videos/agent/month and 100 agents = 5,000 videos/month = ~$250/mo. Healthy unit-economics within Super Pro tier ($199-249/mo) margins.

## Tracking

Container render timing lands in `audit_videos.render_ms` for SLO tracking. Target: ≤60s per render (per the SUPER_PRO_STAGE_1_PLAN.md acceptance bar).

Status pivots into the `/admin/audit-costs` dashboard via a Phase 5.5 follow-on (cost ≠ time, but we want both visible on one operator surface).

## Why container vs pure Worker

Cloudflare Workers cap at 30s CPU + 128MB memory. A 30-second 1080p video render needs both far more CPU (multiple seconds of ffmpeg encode) and more memory (Remotion's React tree + decoded photo bitmaps). Containers run a full Node process with predictable CPU + memory — the only Cloudflare primitive that can actually render this in the budget we want.

Per `docs/PO_DECISIONS.md` recently-answered #1: **Option A — Remotion in Cloudflare Containers** locked over FFmpeg-WASM-in-Worker (B, CPU-bound) and external services (C, 10-20× per-video cost).
