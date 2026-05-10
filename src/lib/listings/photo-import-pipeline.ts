import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import { putObject } from '@/lib/storage/r2';

/**
 * Photo-import pipeline — the per-URL fetch → R2 → CF Images → insert
 * sequence used by both the user-facing import endpoint
 * (POST /api/properties/:id/import-photos) and the hourly dead-letter
 * retry cron (POST /api/cron/photo-import-retry).
 *
 * Why a shared module: the two callers want exactly the same end state
 * (a confirmed `property_images` row with R2 + CF Images backing) but
 * differ in (a) which Supabase client they use — user-session vs.
 * service-role — and (b) what they do with the result. Keeping the
 * pipeline pure-async-function keeps both call sites thin.
 *
 * Bounded retry note: `fetchAsImage` retries transient errors up to
 * `FETCH_MAX_ATTEMPTS` times within a single call. The cron applies an
 * additional outer-loop retry budget (`attempts < 5` on the failure row)
 * so a permanently-blocked CDN doesn't get hammered forever.
 */

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

const FETCH_MAX_ATTEMPTS = 3;
const FETCH_BACKOFF_MS = [500, 1500] as const;

export const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Normalize a `content-type` header value to its base mime, lowercased
 * with no parameters. `image/jpeg;charset=binary` → `image/jpeg`.
 */
export function normalizeContentType(raw: string | null | undefined): string {
  return (raw ?? '').split(';')[0]!.trim().toLowerCase();
}

/**
 * Decide whether a remote response's content-type is one of the image
 * formats we accept for import. Returns the normalized type when the
 * answer is yes; otherwise returns a discriminated error code matching
 * the `errorCode` field on `ImportResult`.
 */
export function classifyImageContentType(
  raw: string | null | undefined,
): { ok: true; type: string } | { ok: false; errorCode: 'not_an_image' | 'unsupported_type' } {
  const ct = normalizeContentType(raw);
  if (!ct.startsWith('image/')) return { ok: false, errorCode: 'not_an_image' };
  if (!EXT_BY_TYPE[ct]) return { ok: false, errorCode: 'unsupported_type' };
  return { ok: true, type: ct };
}

/**
 * Returns true if a `fetchAsImage` error code represents a transient
 * failure worth retrying. The split is intentional:
 *   - Retry: network blips, timeouts, HTTP 408/429/5xx — the upstream
 *     might have been having a moment and a second try could succeed.
 *   - Don't retry: deterministic content errors (`not_an_image`,
 *     `unsupported_type`, `too_large`, `empty`) and HTTP 4xx other than
 *     408/429 (404, 403 won't suddenly succeed).
 */
export function isRetriableFetchError(errorCode: string): boolean {
  if (errorCode === 'timeout' || errorCode === 'fetch_failed') return true;
  if (errorCode.startsWith('fetch_')) {
    const status = Number(errorCode.slice('fetch_'.length));
    if (!Number.isFinite(status)) return false;
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAsImageOnce(
  url: string,
): Promise<{ blob: Blob; contentType: string } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some image CDNs serve different bodies (or 403) to user-agentless
        // clients. A real desktop UA gets us the same bytes a browser would.
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      return { error: `fetch_${res.status}` };
    }
    const classified = classifyImageContentType(res.headers.get('content-type'));
    if (!classified.ok) {
      return { error: classified.errorCode };
    }
    const ct = classified.type;
    const lengthHeader = res.headers.get('content-length');
    if (lengthHeader && Number(lengthHeader) > MAX_IMAGE_BYTES) {
      return { error: 'too_large' };
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) return { error: 'empty' };
    if (buf.byteLength > MAX_IMAGE_BYTES) return { error: 'too_large' };
    return { blob: new Blob([buf], { type: ct }), contentType: ct };
  } catch (e) {
    return {
      error: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'fetch_failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps `fetchAsImageOnce` with bounded retry for transient errors.
 * Up to `FETCH_MAX_ATTEMPTS` total tries; backs off `FETCH_BACKOFF_MS`
 * between them. Non-retriable errors short-circuit immediately so we
 * don't waste budget on a deterministic 404. Returns the attempt count
 * alongside the result so the caller can record it on the dead-letter
 * row.
 */
export async function fetchAsImage(
  url: string,
): Promise<
  | { blob: Blob; contentType: string; attempts: number }
  | { error: string; attempts: number }
> {
  let lastError = 'fetch_failed';
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    const result = await fetchAsImageOnce(url);
    if (!('error' in result)) {
      return { ...result, attempts: attempt };
    }
    lastError = result.error;
    if (!isRetriableFetchError(result.error)) {
      return { error: result.error, attempts: attempt };
    }
    if (attempt < FETCH_MAX_ATTEMPTS) {
      await sleep(FETCH_BACKOFF_MS[attempt - 1] ?? 0);
    }
  }
  return { error: lastError, attempts: FETCH_MAX_ATTEMPTS };
}

interface CfUploadResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: { id: string };
}

export async function pushBlobToCfImages(args: {
  blob: Blob;
  filename: string;
  metadata: Record<string, string>;
}): Promise<string | null> {
  const env = serverEnv();
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  const fd = new FormData();
  fd.append('file', args.blob, args.filename);
  fd.append('metadata', JSON.stringify(args.metadata));
  fd.append('requireSignedURLs', 'false');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      body: fd,
    },
  );
  const json = (await res.json().catch(() => null)) as CfUploadResponse | null;
  if (!res.ok || !json || !json.success || !json.result?.id) {
    const detail = json?.errors?.map((e) => e.message).join(' | ') ?? `HTTP ${res.status}`;
    console.warn(`[photo-import-pipeline] CF Images push failed: ${detail}`);
    return null;
  }
  return json.result.id;
}

/**
 * Outcome of importing a single URL. `ok: true` means the bytes are
 * in R2, the `property_images` row is inserted, and (if successful)
 * Cloudflare Images has the variant. `ok: false` carries the
 * machine-readable `errorCode` and the in-call attempts the fetch
 * helper used so the caller can persist it to the dead-letter row.
 */
export interface ImportResult {
  url: string;
  ok: boolean;
  cfImageId?: string;
  errorCode?: string;
  attempts: number;
}

export interface ImportPipelineDeps {
  /** Supabase client used for the `property_images` insert and the
   *  `resolve_photo_import_failure` RPC on success. The caller chooses
   *  user-session vs. service-role per their auth model. */
  supabase: SupabaseClient;
  /** R2 bucket name. Caller is responsible for the `r2_not_configured`
   *  short-circuit before invoking the pipeline. */
  r2Bucket: string;
}

export interface ImportOneArgs {
  url: string;
  propertyId: string;
  /** Position to write into `property_images.position`. Caller is
   *  responsible for `startCount + index` math; the pipeline doesn't
   *  query the existing count itself. */
  position: number;
  altTextEn: string;
  altTextEs: string;
  /** Source label used as `metadata.uploaded_via` on CF Images and
   *  in logs. `'import-photos'` for the user-driven endpoint,
   *  `'import-photos-cron'` for the dead-letter retry cron. */
  uploadedVia: string;
  /** When true, the pipeline calls `resolve_photo_import_failure` on
   *  success so the dead-letter UI clears the row. The user-facing
   *  endpoint sets this true; the cron also sets it true (resolving a
   *  failure is the whole point). */
  resolveOnSuccess: boolean;
}

/**
 * Run the full per-URL pipeline and return its result. Does NOT call
 * `record_photo_import_failure` on failure — that's the caller's
 * responsibility because the user endpoint and the cron differ on
 * whether to upsert (user) or update-in-place (cron, which already
 * has the row).
 */
export async function importOne(
  deps: ImportPipelineDeps,
  args: ImportOneArgs,
): Promise<ImportResult> {
  const fetchRes = await fetchAsImage(args.url);
  if ('error' in fetchRes) {
    return {
      url: args.url,
      ok: false,
      errorCode: fetchRes.error,
      attempts: fetchRes.attempts,
    };
  }
  const ext = EXT_BY_TYPE[fetchRes.contentType] ?? 'jpg';
  const imageId = crypto.randomUUID();
  const r2Key = `properties/${args.propertyId}/${imageId}.${ext}`;

  try {
    await putObject({
      bucket: deps.r2Bucket,
      key: r2Key,
      body: fetchRes.blob,
      contentType: fetchRes.contentType,
    });
  } catch (e) {
    console.warn(`[photo-import-pipeline] R2 PUT failed for ${args.url}:`, e);
    return {
      url: args.url,
      ok: false,
      errorCode: 'r2_put_failed',
      attempts: fetchRes.attempts,
    };
  }

  const cfImageId = await pushBlobToCfImages({
    blob: fetchRes.blob,
    filename: `${imageId}.${ext}`,
    metadata: {
      property_image_id: imageId,
      property_id: args.propertyId,
      r2_key: r2Key,
      uploaded_via: args.uploadedVia,
    },
  });

  const isPrimary = args.position === 0;

  const { error: insertErr } = await deps.supabase.from('property_images').insert({
    id: imageId,
    property_id: args.propertyId,
    r2_key: r2Key,
    cf_image_id: cfImageId,
    position: args.position,
    is_primary: isPrimary,
    upload_status: 'confirmed',
    alt_text_en: args.altTextEn,
    alt_text_es: args.altTextEs,
  });
  if (insertErr) {
    const code = insertErr.code === '42501' ? 'forbidden' : 'insert_failed';
    console.warn(`[photo-import-pipeline] insert failed for ${args.url}: ${insertErr.message}`);
    return {
      url: args.url,
      ok: false,
      errorCode: code,
      attempts: fetchRes.attempts,
    };
  }

  if (args.resolveOnSuccess) {
    await deps.supabase.rpc('resolve_photo_import_failure', {
      p_property_id: args.propertyId,
      p_source_url: args.url,
    });
  }

  return {
    url: args.url,
    ok: true,
    cfImageId: cfImageId ?? undefined,
    attempts: fetchRes.attempts,
  };
}
