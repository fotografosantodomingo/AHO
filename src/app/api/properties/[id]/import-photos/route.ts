import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { MAX_IMAGES_PER_PROPERTY } from '@/lib/listings/upload';
import {
  EXT_BY_TYPE,
  MAX_IMAGE_BYTES,
  classifyImageContentType,
  importOne,
  isRetriableFetchError,
  normalizeContentType,
  type ImportResult,
} from '@/lib/listings/photo-import-pipeline';
import { buildPhotoAlt, type TransactionType } from '@/lib/listings/photo-seo';
import { getCountryName } from '@/lib/i18n/countries';

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
 *
 * Pipeline extraction: the per-URL fetch → R2 → CF Images → insert
 * sequence lives in `@/lib/listings/photo-import-pipeline` so the
 * dead-letter retry cron (POST /api/cron/photo-import-retry) can reuse
 * it byte-for-byte. This route still owns the request shape, the cap
 * math, and the dead-letter `record_photo_import_failure` upsert on
 * exhaustion — those are user-driven concerns.
 */

export const BodySchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(15),
});

// Re-export shared constants/helpers so the existing test file
// (`tests/unit/import-photos-route.test.ts`) keeps working without a
// rename. New tests should import from the pipeline module directly.
export {
  EXT_BY_TYPE,
  MAX_IMAGE_BYTES,
  classifyImageContentType,
  isRetriableFetchError,
  normalizeContentType,
};

const CONCURRENCY = 4;

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
  // property they can't import photos to it. The transaction_type +
  // property_type + country_code columns feed buildPhotoAlt below so
  // imported photos get the same SEO-rich alt text as manually-uploaded
  // photos ("Modern Villa — villa for sale in Santo Domingo, Dominican
  // Republic (Photo 2 of 8)").
  const { data: property, error: propertyErr } = await supabase
    .from('properties')
    .select(
      'id, org_id, title_en, title_es, city, transaction_type, property_type, country_code',
    )
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
    transaction_type: string;
    property_type: string;
    country_code: string;
  };
  // Title for each locale, falling back across languages when only one
  // is filled (matches the convention in image-uploader.tsx).
  const titleForEn = (propTyped.title_en || propTyped.title_es || 'listing').trim();
  const titleForEs = (propTyped.title_es || propTyped.title_en || 'listing').trim();
  const photoCity = propTyped.city ?? '';
  const countryDisplayEn = getCountryName(propTyped.country_code, 'en');
  const countryDisplayEs = getCountryName(propTyped.country_code, 'es');
  const transactionType = propTyped.transaction_type as TransactionType;
  const propertyType = propTyped.property_type;

  const urls = parsed.data.urls.slice(0, remaining);
  const dedup = Array.from(new Set(urls));
  // Total photo count used for the "Photo X of Y" suffix in alt text —
  // existing confirmed photos plus everything being imported in this
  // call. We use the deduped + truncated list so the count matches
  // what will actually land.
  const totalAfterBatch = startCount + dedup.length;

  /**
   * Persist an exhausted-retry failure to the dead-letter table so the
   * agent can re-attempt later from the listing edit page (or the
   * batched cron). Upserts on `(property_id, source_url)` — repeat
   * failures bump the `attempts` counter and refresh `last_failed_at`
   * without losing the original `first_failed_at`.
   *
   * RLS on `photo_import_failures` mirrors `property_images` so the
   * caller's session token is sufficient — no service-role escalation.
   * Errors are swallowed (logged only): the user-visible result of the
   * import shouldn't fail just because we couldn't bookkeep the failure.
   */
  async function recordFailure(
    sourceUrl: string,
    errorCode: string,
    attempts: number,
  ): Promise<void> {
    const { error } = await supabase.rpc('record_photo_import_failure', {
      p_property_id: propertyId,
      p_source_url: sourceUrl,
      p_error_code: errorCode,
      p_attempts: attempts,
    });
    if (error) {
      console.warn(
        `[import-photos] recordFailure failed for ${sourceUrl}: ${error.message}`,
      );
    }
  }

  // Process each URL through the shared pipeline, slotted by index so
  // we can map results back into a stable order after parallel batches.
  async function processOne(url: string, index: number): Promise<ImportResult> {
    const positionIndex = startCount + index + 1;
    const altTextEn = buildPhotoAlt({
      title: titleForEn,
      transactionType,
      propertyType,
      city: photoCity,
      countryDisplay: countryDisplayEn,
      position: positionIndex,
      total: totalAfterBatch,
      locale: 'en',
    });
    const altTextEs = buildPhotoAlt({
      title: titleForEs,
      transactionType,
      propertyType,
      city: photoCity,
      countryDisplay: countryDisplayEs,
      position: positionIndex,
      total: totalAfterBatch,
      locale: 'es',
    });
    const result = await importOne(
      { supabase, r2Bucket: env.R2_BUCKET_PROPERTY_IMAGES! },
      {
        url,
        propertyId,
        position: startCount + index,
        altTextEn,
        altTextEs,
        uploadedVia: 'import-photos',
        resolveOnSuccess: true,
      },
    );
    if (!result.ok && result.errorCode) {
      await recordFailure(url, result.errorCode, result.attempts);
    }
    return result;
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
