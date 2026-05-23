/**
 * Cloudflare Worker — queue consumer for the `q.video-gen` queue.
 *
 * The main Next.js app's `/api/audit/[id]/video` POST endpoint
 * inserts an `audit_videos` row with status='queued' + enqueues a
 * message on q.video-gen. THIS worker picks up the message, calls
 * the Cloudflare Container's HTTP /render endpoint, then writes the
 * result back to audit_videos (status='ready' + r2_key, or
 * status='failed' + error_code).
 *
 * Idempotency: the queue message includes the audit_videos.id +
 * job_id. Before calling /render we read the row's current status —
 * if it's already 'ready' or 'failed', we skip the render (the
 * message is being redelivered after a transient ack failure).
 *
 * Retry policy: configured in wrangler.toml — 3 attempts with
 * exponential backoff, then DLQ. Permanent failures (e.g.
 * invalid_script) bail to DLQ immediately by acknowledging the
 * message without retry; transient failures (network) throw to
 * trigger the queue's automatic retry.
 */

import type { RenderRequest, RenderResult } from './types';

interface Env {
  /** CF Container binding — exposes a `fetch()` that proxies to the
   *  container's HTTP server. */
  VIDEO_RENDER_CONTAINER: { fetch: (req: Request) => Promise<Response> };
  /** R2 bucket binding — used by the container, NOT this worker.
   *  Listed here for the wrangler.toml binding to materialize. */
  AHO_AUDIT_VIDEOS_R2: R2Bucket;
  /** Supabase service-role key — written into audit_videos. */
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Public CDN base for the rendered video URL — typically
   *  https://videos.advertisehomes.online/<r2_key>. Set when
   *  the R2 bucket's public-read variant is configured. */
  AHO_VIDEO_CDN_BASE?: string;
}

interface QueueMessage {
  auditVideoId: string;
  jobId: string;
  auditId: string;
  r2Key: string;
  script: RenderRequest['script'];
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await handleOne(msg.body, env);
        msg.ack();
      } catch (err) {
        // Throw triggers CF Queue retry per wrangler.toml settings.
        console.error('[video-render-queue] handler threw', {
          auditId: msg.body.auditId,
          jobId: msg.body.jobId,
          error: err instanceof Error ? err.message : String(err),
        });
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, QueueMessage>;

async function handleOne(payload: QueueMessage, env: Env): Promise<void> {
  // Idempotency check — read current audit_videos row status.
  const current = await readAuditVideo(env, payload.auditVideoId);
  if (!current) {
    console.warn('[video-render-queue] row not found, dropping message', {
      auditVideoId: payload.auditVideoId,
    });
    return; // ack — nothing to do
  }
  if (current.status === 'ready' || current.status === 'failed') {
    console.log('[video-render-queue] already terminal, skipping', {
      auditVideoId: payload.auditVideoId,
      status: current.status,
    });
    return;
  }

  // Mark in-progress so concurrent re-deliveries can short-circuit.
  await updateAuditVideo(env, payload.auditVideoId, { status: 'rendering' });

  const renderRequest: RenderRequest = {
    auditId: payload.auditId,
    jobId: payload.jobId,
    r2Key: payload.r2Key,
    script: payload.script,
  };

  // Call the container's HTTP /render endpoint via the CF Containers
  // binding. The binding routes to a warm container instance + spins
  // one up if none exists.
  const renderRes = await env.VIDEO_RENDER_CONTAINER.fetch(
    new Request('http://internal/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(renderRequest),
    }),
  );

  const result = (await renderRes.json()) as RenderResult;

  if (result.ok) {
    const publicUrl = env.AHO_VIDEO_CDN_BASE
      ? `${env.AHO_VIDEO_CDN_BASE}/${result.r2Key}`
      : null;
    await updateAuditVideo(env, payload.auditVideoId, {
      status: 'ready',
      r2_key: result.r2Key,
      public_url: publicUrl,
      duration_ms: result.durationMs,
      output_size_bytes: result.outputSizeBytes,
    });
  } else {
    await updateAuditVideo(env, payload.auditVideoId, {
      status: 'failed',
      error_code: result.error,
      error_detail: result.detail?.slice(0, 280) ?? null,
    });
    // Don't throw — failure is durable, no retry needed for
    // application-level errors. The dashboard's failure-state UI
    // shows the error_code to the agent so they can decide to retry
    // manually.
  }
}

// ─── Supabase admin client — manual fetch, no JS SDK to keep the
//     Worker bundle small. Service-role bypasses RLS so we can write
//     audit_videos directly. ──────────────────────────────────────

interface AuditVideoRow {
  id: string;
  status: 'queued' | 'rendering' | 'ready' | 'failed';
}

async function readAuditVideo(
  env: Env,
  id: string,
): Promise<AuditVideoRow | null> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/audit_videos?id=eq.${id}&select=id,status`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) {
    console.error('[video-render-queue] readAuditVideo failed', {
      id,
      status: res.status,
    });
    return null;
  }
  const rows = (await res.json()) as AuditVideoRow[];
  return rows[0] ?? null;
}

async function updateAuditVideo(
  env: Env,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/audit_videos?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[video-render-queue] updateAuditVideo failed', {
      id,
      status: res.status,
      body: text.slice(0, 280),
    });
  }
}
