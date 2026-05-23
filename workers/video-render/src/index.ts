/**
 * CF Worker entry — owns BOTH the queue consumer AND the
 * `VideoRenderContainer` Durable Object class (Cloudflare Containers
 * unify Worker + Container into one deployable).
 *
 * Architecture:
 *   1. Main Next.js app's POST /api/audit/[id]/video inserts an
 *      audit_videos row + publishes a message to `video-gen` queue.
 *   2. THIS Worker's `queue()` handler picks up the message,
 *      idempotency-checks audit_videos.status, then resolves a
 *      `VideoRenderContainer` instance via `getContainer()`.
 *   3. The container instance is a Durable Object with a Dockerfile
 *      attached — first fetch wakes the container; it sleeps after
 *      `sleepAfter` of idle. The container runs `src/server.ts` on
 *      port 8080 (Hono HTTP server inside the Docker image).
 *   4. Worker writes the render result back to audit_videos via
 *      Supabase REST.
 *
 * Per-audit affinity: we key the container instance by auditId so
 * sequential renders for the same audit (rare — re-renders) hit the
 * warm instance. Otherwise distinct auditIds spread across the herd
 * up to `max_instances`.
 *
 * Idempotency: queue-message re-delivery short-circuits if
 * audit_videos.status is already 'ready' or 'failed'.
 */

import { Container, getContainer } from '@cloudflare/containers';
import type { RenderRequest, RenderResult } from './types';

interface Env {
  /** Durable Object binding for the container class below. CF
   *  Containers conventions: the binding is a DO namespace; you
   *  fetch a specific instance via getContainer(). */
  VIDEO_RENDER: DurableObjectNamespace;
  /** R2 bucket binding — used by the container, NOT this worker. */
  AHO_AUDIT_VIDEOS_R2: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  AHO_R2_ENDPOINT: string;
  AHO_R2_ACCESS_KEY_ID: string;
  AHO_R2_SECRET_ACCESS_KEY: string;
  AHO_R2_BUCKET?: string;
  AHO_VIDEO_CDN_BASE?: string;
}

/**
 * Container class — extends @cloudflare/containers `Container` to
 * declare the Dockerfile, default HTTP port, and idle-sleep policy.
 *
 * envVars below are propagated INTO the container's process env at
 * start time, so src/server.ts can read process.env.AHO_R2_ENDPOINT
 * etc. without a separate "secrets pull" round-trip.
 */
export class VideoRenderContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';

  override envVars = {
    AHO_R2_ENDPOINT: this.env.AHO_R2_ENDPOINT,
    AHO_R2_ACCESS_KEY_ID: this.env.AHO_R2_ACCESS_KEY_ID,
    AHO_R2_SECRET_ACCESS_KEY: this.env.AHO_R2_SECRET_ACCESS_KEY,
    AHO_R2_BUCKET: this.env.AHO_R2_BUCKET ?? 'aho-audit-videos',
  };

  override onStart() {
    console.log('[VideoRenderContainer] started');
  }

  override onStop() {
    console.log('[VideoRenderContainer] stopped (idle sleep)');
  }

  override onError(error: unknown) {
    console.error('[VideoRenderContainer] error:', error);
  }
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
  const current = await readAuditVideo(env, payload.auditVideoId);
  if (!current) {
    console.warn('[video-render-queue] row not found, dropping', {
      auditVideoId: payload.auditVideoId,
    });
    return;
  }
  if (current.status === 'ready' || current.status === 'failed') {
    console.log('[video-render-queue] already terminal, skipping', {
      auditVideoId: payload.auditVideoId,
      status: current.status,
    });
    return;
  }

  await updateAuditVideo(env, payload.auditVideoId, { status: 'rendering' });

  const renderRequest: RenderRequest = {
    auditId: payload.auditId,
    jobId: payload.jobId,
    r2Key: payload.r2Key,
    script: payload.script,
  };

  // Key the container instance by auditId so re-renders of the same
  // audit reuse the warm container. Distinct auditIds spread across
  // the herd up to max_instances.
  const container = getContainer(env.VIDEO_RENDER, payload.auditId);
  const renderRes = await container.fetch(
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
  }
}

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
