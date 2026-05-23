# aho-video-render — Cloudflare Containers + Worker (Phase 4 4a-container)

> **Status: scaffolded 2026-05-21, NOT deployed.** Code is complete + reviewable. Deploy requires PO to (a) enable Cloudflare Containers on the account (currently in private beta), (b) create the R2 bucket + queue, (c) set secrets. See "Deploy procedure" below.

## What this worker does

Renders 15-30s vertical 9:16 Reel/TikTok videos for AHO's Free Audit pipeline.

**Flow:**

1. Main Next.js app's `POST /api/audit/[id]/video` inserts an `audit_videos` row with `status='queued'` and enqueues a job on `q.video-gen`.
2. This worker's queue consumer (`src/index.ts`) picks up the job, idempotency-checks `audit_videos.status`, then calls the Cloudflare Container via the `VIDEO_RENDER_CONTAINER` binding.
3. The Container (`src/server.ts` running inside `Dockerfile`) renders the MP4 via `@remotion/renderer`, uploads to R2 under `audit-videos/<audit_id>/<job_id>.mp4`, returns the R2 key.
4. Worker writes `r2_key` + `public_url` + `status='ready'` back via Supabase REST. On failure: `error_code` + `status='failed'`.
5. UI polls `GET /api/audit/[id]/video` and renders the `<video>` once `status === 'ready'`.

## What ships in this directory (slice 4a-container)

| File | Purpose |
|---|---|
| `src/types.ts` | Shared types between Worker + Container (mirrors `src/lib/creative/video-script.ts` in the main app) |
| `src/composition.tsx` | Remotion JSX root — defines the `reel-real-estate-v1` composition (title card → Ken Burns photo sequence → price card → persistent AHO brand footer). 1080×1920 @ 24fps. |
| `src/server.ts` | Hono HTTP server inside the container — `POST /render` runs the render + R2 upload. Caches the Remotion bundle across requests. |
| `src/index.ts` | CF Worker queue consumer — idempotency check + container fetch + Supabase write-back |
| `Dockerfile` | `node:20-bookworm-slim` + Chromium + ffmpeg + tsx runtime |
| `package.json` | Worker + container deps (Hono, Remotion, AWS SDK for R2, react/react-dom) |
| `tsconfig.json` | Strict TS, ESNext modules, JSX react |
| `remotion.config.ts` | Remotion CLI config for local dev render |
| `wrangler.toml` | CF Worker + queue consumer + R2 binding + Containers binding |

## Pre-requisites (PO action — gates deploy)

These must be in place before the deploy procedure below works:

1. **Cloudflare Containers feature enabled on the AHO account** — private beta as of 2026-05-21. Request via [developers.cloudflare.com/containers](https://developers.cloudflare.com/containers/).
2. **R2 bucket `aho-audit-videos`** — create via dashboard or `wrangler r2 bucket create aho-audit-videos`.
3. **Queue `video-gen` + DLQ `video-gen-dlq`** — `wrangler queues create video-gen` and `wrangler queues create video-gen-dlq`.
4. **DNS for the public video CDN** — `videos.advertisehomes.online` → R2 public-read endpoint (or CF Images domain if we route through Images for variant generation). Configurable via `AHO_VIDEO_CDN_BASE` in `wrangler.toml`.

## Deploy procedure (one-time setup)

```bash
cd workers/video-render

# 1. Install deps
corepack pnpm@9.12.3 install

# 2. Set Worker secrets (sources from .env.local in the main repo)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY

# 3. Build + push the container image to CF's registry
wrangler containers deploy

# 4. Set container env vars (R2 credentials for the S3 SDK)
wrangler containers env set AHO_R2_ENDPOINT 'https://<account-id>.r2.cloudflarestorage.com'
wrangler containers env set AHO_R2_ACCESS_KEY_ID '<from R2 dashboard>'
wrangler containers env set AHO_R2_SECRET_ACCESS_KEY '<from R2 dashboard>'

# 5. Deploy the Worker (queue consumer + Containers binding)
wrangler deploy
```

## Deploy procedure (subsequent code changes)

```bash
cd workers/video-render

# Composition-only changes (src/composition.tsx + dependencies):
wrangler containers deploy

# Worker-only changes (src/index.ts):
wrangler deploy

# Both changed:
wrangler containers deploy && wrangler deploy
```

## Testing locally (without CF Containers)

The HTTP server in `src/server.ts` runs standalone — useful for iterating on the composition without round-tripping through CF.

```bash
# Start the container's HTTP server locally
corepack pnpm@9.12.3 install
corepack pnpm@9.12.3 start  # listens on :8080

# In another terminal: POST a sample render request
curl -X POST http://localhost:8080/render \
  -H 'content-type: application/json' \
  -d @test/sample-render-request.json

# Watch the output mp4 land in $TMPDIR/<jobId>.mp4
```

(A sample request fixture isn't checked in yet — produce one via the main app's `/api/audit/[id]/video` endpoint and capture the queue payload.)

## What's NOT in slice 4a-container (future work)

- **Music bed** — `script.musicUrl` is always `null` in v1 per PO #4 (royalty-free music selection deferred to Phase 4.1). When music lands: container fetches Pixabay/YT-Audio URL, ffmpeg-mixes into the final encode, attribution overlay on the brand-footer band.
- **Per-photo Ken-Burns direction randomization** — currently every photo zooms+drifts in the same direction; alternating per index would be a nice-to-have.
- **CF Images variant pipeline** — today R2 serves the MP4 directly. Routing through CF Images would let us generate webm + low-bitrate variants for mobile. Not urgent for v1.
- **Concurrency >1 per container** — the v1 server processes one render at a time. CF Containers' `max_instances=4` scales the herd; per-instance concurrency stays at 1 because Chromium is single-threaded.

## Operational guarantees

- **Idempotency:** the Worker checks `audit_videos.status` before calling `/render`. Re-delivered queue messages (after a transient ack failure) short-circuit if the row is already `ready` or `failed`.
- **Retry policy:** 3 attempts with exponential backoff, then DLQ. Application-level failures (`invalid_script`, `r2_upload_failed`) don't retry — they write `status='failed'` and bail.
- **Cleanup:** the container's render path writes to `$TMPDIR/<jobId>.mp4` and unlinks on both success and failure. No accumulating disk usage across a long-lived container instance.
- **Brand attribution:** `BrandFooter` overlays the bottom 140px on EVERY frame (per `docs/DECISIONS.md` 2026-05-17). A viewer who watches the first 2s sees the brand; a viewer who screenshots any frame sees the brand.

## Operational caveats

- **Container cold start:** ~10s the first time a job arrives after `min_instances=0`. Subsequent jobs to the same instance are warm. If we set `min_instances=1` we pay for an always-on container even with zero traffic — defer until we see real usage.
- **Cost per render:** estimated $0.04-0.07 per video at CF Containers' beta pricing (2 vCPU × 4GB × ~25s render). Logged in the success path (`durationMs`) so we can true up unit economics once real numbers land.
- **Photo URL fetch failures:** if even one of the 7 photos 404s, Remotion render fails with `photo_download_failed`. We retry up to 3 times via the queue; persistent failure surfaces in `audit_videos.error_code`. Future iteration: skip the bad photo + render with N-1 instead of failing entirely.
