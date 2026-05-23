import { Hono } from 'hono';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { RenderRequest, RenderResult } from './types';

/**
 * HTTP server that lives INSIDE the Cloudflare Container. The CF
 * Worker queue consumer (workers/video-render/src/index.ts) calls
 * POST /render with a RenderRequest payload; this server runs the
 * Remotion render pipeline + uploads the MP4 to R2 + returns the
 * R2 key.
 *
 * Why a long-lived container vs. a stateless function: Remotion
 * needs a Chromium bundle (~300MB) loaded into memory + an ffmpeg
 * binary on disk + a Vite-bundled composition JS. Cold-starting all
 * of that per request would push end-to-end render time well past
 * the 60s budget. The container stays warm and serves many requests
 * sequentially.
 *
 * Concurrency: ONE render at a time per container instance. Chromium
 * is single-threaded for renderMedia(); running two in parallel
 * doubles memory pressure without speedup. The CF Containers binding
 * can scale to N instances when queue depth grows — that's
 * configured in wrangler.toml.
 *
 * Failure modes: photo download failure (photo URL 404s or times
 * out), Remotion render failure (composition error, OOM), R2 upload
 * failure (S3 API rejects). Each maps to a distinct RenderFailure.error
 * code so the CF Worker can write a structured failure into
 * audit_videos.error_code for the dashboard polling endpoint.
 */

const app = new Hono();

// Bundle the composition ONCE at container startup. Reused across
// every render call — saves ~3-5s per render that would otherwise be
// spent re-bundling. The bundle is the Webpack output of
// composition.tsx; Remotion serves it to headless Chromium during
// renderMedia().
let cachedBundleLocation: string | null = null;

async function getBundleLocation(): Promise<string> {
  if (cachedBundleLocation) return cachedBundleLocation;
  const entryPoint = path.join(process.cwd(), 'src/composition.tsx');
  const out = await bundle({
    entryPoint,
    // Don't pull in webpackOverride — defaults are fine for v1.
  });
  cachedBundleLocation = out;
  return out;
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.AHO_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AHO_R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AHO_R2_SECRET_ACCESS_KEY ?? '',
  },
});

app.get('/healthz', (c) => c.text('ok'));

app.post('/render', async (c): Promise<Response> => {
  const startedAt = Date.now();
  let payload: RenderRequest;
  try {
    payload = (await c.req.json()) as RenderRequest;
  } catch {
    return c.json<RenderResult>(
      { ok: false, error: 'invalid_script', detail: 'malformed JSON' },
      400,
    );
  }
  if (!payload?.script || !payload?.r2Key || !payload?.auditId) {
    return c.json<RenderResult>(
      { ok: false, error: 'invalid_script', detail: 'missing auditId/r2Key/script' },
      400,
    );
  }

  // Tmp file path inside the container — written by renderMedia()
  // and uploaded to R2 immediately after. Clean up regardless of
  // success/failure so a long-lived container doesn't accumulate
  // ~3MB per render.
  const tmpOut = path.join(os.tmpdir(), `${payload.jobId}.mp4`);

  try {
    const bundleLocation = await getBundleLocation();

    // selectComposition reads the composition metadata WITHOUT
    // rendering — gives us the validated id + dimensions before we
    // commit to the render run.
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: payload.script.composition,
      inputProps: payload.script,
    });

    await renderMedia({
      serveUrl: bundleLocation,
      composition,
      codec: 'h264',
      outputLocation: tmpOut,
      inputProps: payload.script,
      // 1080×1920 9:16. h264 + AAC is the broadest-support format for
      // IG Reels + FB Reels + TikTok + LinkedIn video.
      pixelFormat: 'yuv420p',
      // crf=23 is the visually-lossless sweet spot for 1080p video.
      // Trade-off: ~3-5MB per 20s clip. CF Images charges per byte;
      // worth it for the quality bar.
      crf: 23,
      // Bound render time so a stuck Chromium tab can't pin the
      // container forever. 90s budget aligns with the SLO doc; if
      // we ever hit this the failure code surfaces in the Worker
      // log so we know the script needs to be simplified.
      timeoutInMilliseconds: 90_000,
    });

    const fileBuf = await fs.readFile(tmpOut);

    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.AHO_R2_BUCKET ?? 'aho-audit-videos',
          Key: payload.r2Key,
          Body: fileBuf,
          ContentType: 'video/mp4',
          // CacheControl is set on the public-read variant served
          // through the CF Images domain — R2 itself doesn't serve
          // these to end users.
        }),
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error('[video-render] R2 upload failed', { auditId: payload.auditId, detail });
      return c.json<RenderResult>(
        { ok: false, error: 'r2_upload_failed', detail },
        500,
      );
    }

    const durationMs = Date.now() - startedAt;
    console.log('[video-render] success', {
      auditId: payload.auditId,
      jobId: payload.jobId,
      r2Key: payload.r2Key,
      durationMs,
      outputSizeBytes: fileBuf.byteLength,
    });

    return c.json<RenderResult>({
      ok: true,
      r2Key: payload.r2Key,
      durationMs,
      outputSizeBytes: fileBuf.byteLength,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // Try to classify the error from message contents — Remotion
    // doesn't expose typed errors today, so we string-match against
    // known failure patterns. Anything that's not classifiable falls
    // through to internal_error.
    let code: RenderResult extends { error: infer E } ? E : never = 'remotion_render_failed';
    if (/fetch|ENOTFOUND|ECONNREFUSED|timeout/i.test(detail)) {
      code = 'photo_download_failed';
    }
    console.error('[video-render] render failed', {
      auditId: payload.auditId,
      jobId: payload.jobId,
      code,
      detail,
    });
    return c.json<RenderResult>({ ok: false, error: code, detail }, 500);
  } finally {
    fs.unlink(tmpOut).catch(() => {
      /* swallow — tmp file may not exist if renderMedia threw early */
    });
  }
});

const port = Number(process.env.PORT ?? 8080);
console.log(`[video-render] listening on :${port}`);

// Bun + Node compatibility: prefer Bun.serve when available, fall
// back to @hono/node-server. The Dockerfile uses node:20-bookworm-slim
// so we'll be on Node — keep this branch as the runtime path.
if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') {
  (
    globalThis as { Bun: { serve: (cfg: { port: number; fetch: typeof app.fetch }) => void } }
  ).Bun.serve({ port, fetch: app.fetch });
} else {
  // Lazy import so this file doesn't error in Bun-only environments.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { serve } = require('@hono/node-server');
  serve({ port, fetch: app.fetch });
}
