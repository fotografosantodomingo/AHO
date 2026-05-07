/**
 * R2 → Cloudflare Images backfill.
 *
 * Walks every `property_images` row that has an `r2_key` but null
 * `cf_image_id`, downloads the original from R2 (via the public URL),
 * uploads it to Cloudflare Images, and writes the returned ID back to
 * the DB. Subsequent renders pick the variant URLs via `buildImageUrl()`.
 *
 * Idempotent: rows that already have `cf_image_id` are skipped.
 * Re-runnable: failures don't poison subsequent runs.
 *
 * Rate-limited: Cloudflare Images upload limit is ~10 req/sec sustained.
 * We pace at 200ms between uploads (5/sec) to stay safely under the cap.
 *
 * Why we don't stream R2 → CF Images directly: R2 public URLs are
 * cached by the Cloudflare CDN, which is fine. Downloading via fetch()
 * gives us the file in memory; then we POST to CF Images with a
 * FormData multipart body — that's the only upload format the v1 API
 * accepts. For ≤25 MiB AHO images this fits comfortably in Edge worker
 * memory.
 *
 * Usage:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/backfill-r2-to-cf-images.ts
 *
 * Env required:
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN — must include `Cloudflare Images: Edit` scope.
 *   - SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL+anon for read-only test)
 *   - NEXT_PUBLIC_R2_PUBLIC_URL — base of the R2 public bucket.
 */
import { createClient } from '@supabase/supabase-js';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_PUBLIC = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

if (!ACCOUNT_ID || !API_TOKEN || !SUPABASE_URL || !SERVICE_KEY || !R2_PUBLIC) {
  console.error(
    'Missing env. Need: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, ' +
      '(NEXT_PUBLIC_)SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_R2_PUBLIC_URL.',
  );
  process.exit(1);
}

const CF_UPLOAD_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

interface ImageRow {
  id: string;
  property_id: string;
  r2_key: string;
}

interface CfUploadResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: { id: string };
}

async function uploadOne(row: ImageRow): Promise<string> {
  const r2Url = `${R2_PUBLIC!.replace(/\/$/, '')}/${row.r2_key}`;
  const resR2 = await fetch(r2Url);
  if (!resR2.ok) {
    throw new Error(`R2 fetch ${r2Url} failed: ${resR2.status}`);
  }
  const blob = await resR2.blob();
  // The CF Images API derives the original filename / extension from
  // the FormData entry's filename. Pass the R2 key tail so the
  // returned image keeps a recognizable name.
  const filename = row.r2_key.split('/').pop() ?? `${row.id}.jpg`;
  const fd = new FormData();
  fd.append('file', blob, filename);
  // metadata.property_image_id keeps the link back to the DB row in
  // case we ever need to reverse-lookup what's in CF Images.
  fd.append(
    'metadata',
    JSON.stringify({
      property_image_id: row.id,
      property_id: row.property_id,
      r2_key: row.r2_key,
    }),
  );
  fd.append('requireSignedURLs', 'false');

  const resCf = await fetch(CF_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: fd,
  });
  const json = (await resCf.json()) as CfUploadResponse;
  if (!resCf.ok || !json.success || !json.result?.id) {
    const errs = json.errors?.map((e) => e.message).join(' | ') ?? `HTTP ${resCf.status}`;
    throw new Error(`CF upload failed for ${row.r2_key}: ${errs}`);
  }
  return json.result.id;
}

async function main(): Promise<void> {
  // Pull every confirmed image row that doesn't yet have a CF Images id.
  // We page in batches of 200 to keep memory + CF API quota predictable.
  const PAGE_SIZE = 200;
  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('property_images')
      .select('id, property_id, r2_key')
      .is('cf_image_id', null)
      .not('r2_key', 'is', null)
      .eq('upload_status', 'confirmed')
      .order('created_at', { ascending: true })
      .limit(PAGE_SIZE);

    if (error) {
      console.error('Supabase select failed:', error.message);
      process.exit(1);
    }

    const rows = (data ?? []) as ImageRow[];
    if (rows.length === 0) break;

    console.log(`Processing batch of ${rows.length} images…`);
    for (const row of rows) {
      try {
        const cfId = await uploadOne(row);
        const { error: updErr } = await supabase
          .from('property_images')
          .update({ cf_image_id: cfId })
          .eq('id', row.id);
        if (updErr) {
          console.error(
            `✗ ${row.r2_key} uploaded as ${cfId} but DB update failed: ${updErr.message}`,
          );
          totalFailed++;
        } else {
          console.log(`✓ ${row.r2_key} → ${cfId}`);
          totalSucceeded++;
        }
      } catch (e) {
        console.error(`✗ ${row.r2_key}: ${e instanceof Error ? e.message : e}`);
        totalFailed++;
      }
      totalProcessed++;
      // Pace ~5/sec. CF Images allows higher, but we're not in a hurry.
      await new Promise((r) => setTimeout(r, 200));
    }
    if (rows.length < PAGE_SIZE) break;
  }

  console.log(
    `\nDone. Processed ${totalProcessed}, succeeded ${totalSucceeded}, failed ${totalFailed}.`,
  );
  process.exit(totalFailed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
