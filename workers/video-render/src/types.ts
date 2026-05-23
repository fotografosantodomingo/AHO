/**
 * Shared types between the CF Worker queue consumer + the container's
 * HTTP server. Both ends of the wire must agree on this shape, so it
 * lives in `src/types.ts` and gets imported from both contexts.
 *
 * Mirrors `VideoScript` in `src/lib/creative/video-script.ts` of the
 * main Next.js app — kept in sync manually because the two apps don't
 * share a package boundary today. If the main-app contract changes,
 * update this file in the same PR.
 */

export interface VideoScript {
  composition: 'reel-real-estate-v1';
  width: 1080;
  height: 1920;
  fps: 24;
  durationFrames: number;
  title: {
    text: string;
    city: string | null;
  };
  photos: Array<{
    url: string;
    caption: string;
  }>;
  price: {
    label: string | null;
    cta: string;
  };
  style: {
    bg: string;
    ink: string;
    inkMuted: string;
    accent: string;
    accentInk: string;
    photoBg: string;
  };
  market: 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';
  sourceUrl: string;
  musicUrl: string | null;
}

export interface RenderRequest {
  /** Audit row id — passed through for logging + correlation. */
  auditId: string;
  /** Idempotency key — repeating a render for the same job_id is a
   *  no-op once the first render succeeds. The Worker reads
   *  `audit_videos.job_id` and short-circuits if `status='ready'`. */
  jobId: string;
  /** R2 destination key. Container uploads here; Worker reads back
   *  the key to write into `audit_videos.r2_key`. */
  r2Key: string;
  script: VideoScript;
}

export interface RenderSuccess {
  ok: true;
  r2Key: string;
  durationMs: number;
  outputSizeBytes: number;
}

export interface RenderFailure {
  ok: false;
  error:
    | 'photo_download_failed'
    | 'remotion_render_failed'
    | 'r2_upload_failed'
    | 'invalid_script'
    | 'internal_error';
  detail?: string;
}

export type RenderResult = RenderSuccess | RenderFailure;
