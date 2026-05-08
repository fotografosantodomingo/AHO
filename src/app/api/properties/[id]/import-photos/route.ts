import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { putObject } from '@/lib/storage/r2';
import { MAX_IMAGES_PER_PROPERTY } from '@/lib/listings/upload';

export const runtime = 'edge';

/**
 * POST /api/properties/:id/import-photos
 *
 * Server-side photo migration for the URL-import flow (Day 5/6 + Sprint 2).
 * The agent pasted a portal URL → Claude returned `photoUrls[]` in
 * ImportedFacts. After the listing row is created, the form calls this
 * endpoint with those URLs. The server fetches each remote image, PUTs it
 * to R2, pushes it to Cloudflare Images, and inserts a confirmed
 * `property_images` row — exactly the same end state as a user-uploaded
 * photo.
 *
 * Why server-side: avoids exposing the agent's browser to CORS / hotlink
 * blocks on portal CDNs (otodom, idealista, etc.) and lets us cap fetch
 * size + budget without trusting the client.
 *
 * Concurrency: small parallel batches (4 at a time) keep total wall time
 * down without exhausting the Edge function's request budget. Sequential
 * inserts would serialize the slowest network leg of every URL.
 *
 * Cap: 12 URLs per call. The Edge function has ~30s of wall time on
 * Pages free; a few large images at slow CDNs eat that quickly. Listings
 * with more photos can re-call or fall back to manual upload.
 */

export const BodySchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(15),
});

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;

/**
 * Bounded retry config for `fetchAsImage`. Two extra attempts beyond the
 * first call: 3 total. Backoff is roughly exponential — 500ms, 1500ms —
 * picked to be short enough to fit inside the Edge function's ~30s wall
 * budget while still letting a CDN recover from a brief 503/timeout.
 */
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
 *
 * Exported for unit tests + reuse if another importer flow needs the
 * same normalization.
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
 * Cap-aware slot calculation for how many of a caller-supplied URL list
 * we will actually attempt to import. Mirrors what the POST handler
 * does inline; extracted so the math is unit-testable without spinning
 * up the full auth + DB stack.
 */
export function computeImportSlots(args: {
  existingCount: number;
  urlsLength: number;
  cap: number;
}): { remaining: number; toProcess: number; skipped: number } {
  const remaining = Math.max(0, args.cap - args.existingCount);
  const toProcess = Math.min(remaining, args.urlsLength);
  const skipped = args.urlsLength - toProcess;
  return { remaining, toProcess, skipped };
}

interface CfUploadResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: { id: string };
}

interface ImportResult {
  url: string;
  ok: boolean;
  cfImageId?: string;
  errorCode?: string;
  attempts?: number;
}

/**
 * Returns true if a `fetchAsImage` error code represents a transient
 * failure worth retrying. The split is intentional:
 *   - Retry: network blips, timeouts, HTTP 408/429/5xx — the upstream
 *     might have been having a moment and a second try could succeed.
 *   - Don't retry: deterministic content errors (`not_an_image`,
 *     `unsupported_type`, `too_large`, `empty`) and HTTP 4xx other than
 *     408/429 (404, 403 won't suddenly succeed).
 *
 * Exported so the unit tests can verify the classification table without
 * mocking the network.
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
async function fetchAsImage(
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

async function pushBlobToCfImages(args: {
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
    console.warn(`[import-photos] CF Images push failed: ${detail}`);
    return null;
  }
  return json.result.id;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: propertyId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: user, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // RLS-protected lookup acts as authz check. If the user can't read the
  // property they can't import photos to it.
  const { data: property, error: propertyErr } = await supabase
    .from('properties')
    .select('id, org_id, title_en, title_es, city')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!property) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const env = serverEnv();
  if (!env.R2_BUCKET_PROPERTY_IMAGES) {
    return NextResponse.json({ error: 'r2_not_configured' }, { status: 503 });
  }

  // Cap check — leave room for the agent to add manual photos later.
  const { count: existingCount, error: countErr } = await supabase
    .from('property_images')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId);
  if (countErr) {
    return NextResponse.json({ error: 'count_failed' }, { status: 500 });
  }

  const startCount = existingCount ?? 0;
  const remaining = Math.max(0, MAX_IMAGES_PER_PROPERTY - startCount);
  if (remaining === 0) {
    return NextResponse.json(
      { ok: true, imported: 0, skipped: parsed.data.urls.length, failed: 0, results: [] },
      { status: 200 },
    );
  }

  const propTyped = property as {
    id: string;
    org_id: string;
    title_en: string | null;
    title_es: string | null;
    city: string | null;
  };
  const altBaseEn =
    propTyped.title_en ?? propTyped.title_es ?? `Listing in ${propTyped.city ?? ''}`.trim();
  const altBaseEs = propTyped.title_es ?? propTyped.title_en ?? `Inmueble en ${propTyped.city ?? ''}`.trim();

  const urls = parsed.data.urls.slice(0, remaining);
  const dedup = Array.from(new Set(urls));

  // Process each URL and return its slotted result, indexed so we can
  // map back into a stable order after parallel batches finish.
  async function processOne(url: string, index: number): Promise<ImportResult> {
    const fetchRes = await fetchAsImage(url);
    if ('error' in fetchRes) {
      return { url, ok: false, errorCode: fetchRes.error, attempts: fetchRes.attempts };
    }
    const ext = EXT_BY_TYPE[fetchRes.contentType] ?? 'jpg';
    const imageId = crypto.randomUUID();
    const r2Key = `properties/${propertyId}/${imageId}.${ext}`;

    try {
      await putObject({
        bucket: env.R2_BUCKET_PROPERTY_IMAGES!,
        key: r2Key,
        body: fetchRes.blob,
        contentType: fetchRes.contentType,
      });
    } catch (e) {
      console.warn(`[import-photos] R2 PUT failed for ${url}:`, e);
      return {
        url,
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
        property_id: propertyId,
        r2_key: r2Key,
        uploaded_via: 'import-photos',
      },
    });

    const position = startCount + index;
    const isPrimary = position === 0;

    const { error: insertErr } = await supabase.from('property_images').insert({
      id: imageId,
      property_id: propertyId,
      r2_key: r2Key,
      cf_image_id: cfImageId,
      position,
      is_primary: isPrimary,
      upload_status: 'confirmed',
      alt_text_en: `${altBaseEn} — ${index + 1}`,
      alt_text_es: `${altBaseEs} — ${index + 1}`,
    });
    if (insertErr) {
      const code = insertErr.code === '42501' ? 'forbidden' : 'insert_failed';
      console.warn(`[import-photos] insert failed for ${url}: ${insertErr.message}`);
      return { url, ok: false, errorCode: code, attempts: fetchRes.attempts };
    }
    return {
      url,
      ok: true,
      cfImageId: cfImageId ?? undefined,
      attempts: fetchRes.attempts,
    };
  }

  const results: ImportResult[] = new Array(dedup.length);
  for (let i = 0; i < dedup.length; i += CONCURRENCY) {
    const batch = dedup
      .slice(i, i + CONCURRENCY)
      .map((url, j) => ({ url, index: i + j }));
    const settled = await Promise.all(
      batch.map(({ url, index }) => processOne(url, index)),
    );
    for (let j = 0; j < settled.length; j++) {
      results[i + j] = settled[j]!;
    }
  }

  const imported = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const skipped = parsed.data.urls.length - dedup.length + (parsed.data.urls.length - urls.length);

  return NextResponse.json({
    ok: true,
    imported,
    skipped,
    failed,
    results,
  });
}
