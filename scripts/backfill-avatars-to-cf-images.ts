/**
 * Avatar backfill: R2 → Cloudflare Images.
 *
 * Walks every `profiles.avatar_url` that still points at the legacy
 * R2 host (`images.advertisehomes.online/avatars/...`) and migrates it
 * to a Cloudflare Images thumbnail URL. Idempotent — rows whose
 * avatar_url already starts with `https://imagedelivery.net/` are
 * skipped.
 *
 * Why thumbnail variant: every place we paint the avatar is small —
 * 80×80 on the agent profile hero, 56×56 on listing detail. A 200×200
 * cover variant (~10 KiB) is the right size at any reasonable DPR
 * without over-serving. Larger variants are pointless for avatars.
 *
 * Run AFTER /api/me/avatar has been deployed in CF Images mode, so
 * any new uploads land directly in the new pipeline. Old uploads
 * stuck on R2 get pulled across in this script.
 *
 * Usage:
 *   set -a && source .env.local && set +a && pnpm tsx scripts/backfill-avatars-to-cf-images.ts
 *
 * Env required:
 *   - CLOUDFLARE_ACCOUNT_ID
 *   - CLOUDFLARE_API_TOKEN — must include `Cloudflare Images: Edit`
 *   - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - NEXT_PUBLIC_CF_IMAGES_HASH
 */
import { createClient } from '@supabase/supabase-js';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CF_HASH = process.env.NEXT_PUBLIC_CF_IMAGES_HASH;

if (!ACCOUNT_ID || !API_TOKEN || !SUPABASE_URL || !SERVICE_KEY || !CF_HASH) {
  console.error(
    'Missing env. Need: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, ' +
      '(NEXT_PUBLIC_)SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_CF_IMAGES_HASH.',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const CF_UPLOAD_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/images/v1`;

interface CfUploadResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: { id: string };
}

async function migrateOne(profileId: string, oldUrl: string): Promise<string> {
  const fetchRes = await fetch(oldUrl);
  if (!fetchRes.ok) {
    throw new Error(`download ${oldUrl} → HTTP ${fetchRes.status}`);
  }
  const blob = await fetchRes.blob();
  const filename = oldUrl.split('/').pop() ?? `avatar-${profileId}.jpg`;
  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append(
    'metadata',
    JSON.stringify({
      kind: 'avatar',
      user_id: profileId,
      migrated_from_r2: oldUrl,
    }),
  );
  fd.append('requireSignedURLs', 'false');

  const cfRes = await fetch(CF_UPLOAD_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    body: fd,
  });
  const cfJson = (await cfRes.json()) as CfUploadResponse;
  if (!cfRes.ok || !cfJson.success || !cfJson.result?.id) {
    const detail =
      cfJson.errors?.map((e) => e.message).join(' | ') ?? `HTTP ${cfRes.status}`;
    throw new Error(`upload to CF Images failed: ${detail}`);
  }
  return `https://imagedelivery.net/${CF_HASH}/${cfJson.result.id}/thumbnail`;
}

async function main(): Promise<void> {
  // Pull every profile with a non-imagedelivery avatar URL set. Limit
  // 1000 — well above current cardinality, no need to page.
  const { data, error } = await supabase
    .from('profiles')
    .select('id, avatar_url')
    .not('avatar_url', 'is', null)
    .not('avatar_url', 'like', 'https://imagedelivery.net/%');
  if (error) {
    console.error('Supabase select failed:', error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as Array<{ id: string; avatar_url: string }>;
  if (rows.length === 0) {
    console.log('No avatars need migrating.');
    return;
  }

  console.log(`Migrating ${rows.length} avatar(s)…`);
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const newUrl = await migrateOne(row.id, row.avatar_url);
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ avatar_url: newUrl })
        .eq('id', row.id);
      if (updErr) {
        console.error(`✗ ${row.id} uploaded as ${newUrl} but DB update failed: ${updErr.message}`);
        failed++;
      } else {
        console.log(`✓ ${row.id}: ${row.avatar_url}`);
        console.log(`           → ${newUrl}`);
        succeeded++;
      }
    } catch (e) {
      console.error(`✗ ${row.id}: ${e instanceof Error ? e.message : e}`);
      failed++;
    }
    // Pace ~5/sec, plenty of headroom on CF Images quota.
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
