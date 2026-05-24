import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv, serverEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/me/avatar
 *
 * Multipart upload of a profile photo for the signed-in user.
 *
 * Storage path (since 2026-05-07): direct upload to Cloudflare Images.
 * The avatar_url stored on profiles points at
 * `imagedelivery.net/<hash>/<image_id>/thumbnail` — small (200×200
 * cover, ~10 KiB), exactly what the 80×80 hero on the agent profile
 * page paints. No R2 round-trip; CF Images is the source of truth for
 * avatars going forward. Property images still write to R2 first
 * because they have larger originals + multiple variant needs (see
 * /api/properties/[id]/images for that pipeline).
 *
 * Constraints:
 *   - Auth required (anon → 401)
 *   - byteSize ≤ 2_000_000 (~2 MB) — server-side enforced; the client
 *     UI should also gate but this is the trust boundary
 *   - contentType ∈ { image/jpeg, image/png, image/webp } — server-side
 *     allowlist; client-side accept attribute is UX, not security
 *
 * Side effect: updates `profiles.avatar_url` to the new CF Images URL.
 * Old CF Images entries from prior uploads become orphans (no
 * automatic cleanup; the URL stops being referenced once the row
 * updates). Cleanup pass is a separate concern.
 *
 * DELETE /api/me/avatar removes the avatar_url (no CF Images delete
 * — see orphan note above).
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 2_000_000;

interface CfUploadResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: { id: string };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;

  const env = serverEnv();
  const pub = publicEnv();
  // Cloudflare Images runtime requirements. Without these the route
  // can't write the avatar; we 503 instead of silently falling back so
  // the agent gets actionable feedback.
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    !env.CLOUDFLARE_ACCOUNT_ID ||
    !pub.NEXT_PUBLIC_CF_IMAGES_HASH
  ) {
    return NextResponse.json(
      { ok: false, errorCode: 'cf_images_not_configured' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_multipart' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_file' },
      { status: 400 },
    );
  }

  const contentType = file.type;
  if (!ALLOWED_TYPES.includes(contentType as (typeof ALLOWED_TYPES)[number])) {
    return NextResponse.json(
      { ok: false, errorCode: 'unsupported_type' },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, errorCode: 'too_large', limit: MAX_BYTES, got: file.size },
      { status: 413 },
    );
  }

  // POST to CF Images. The v1 API expects multipart/form-data with the
  // file under `file`; we attach a metadata blob with `kind: avatar`
  // and the user_id so we can audit/clean up later if needed.
  const cfFd = new FormData();
  cfFd.append('file', file, file.name || `avatar-${userId}.jpg`);
  cfFd.append(
    'metadata',
    JSON.stringify({ kind: 'avatar', user_id: userId, uploaded_at: new Date().toISOString() }),
  );
  cfFd.append('requireSignedURLs', 'false');

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      body: cfFd,
    },
  );
  const cfJson = (await cfRes.json()) as CfUploadResponse;
  if (!cfRes.ok || !cfJson.success || !cfJson.result?.id) {
    const detail = cfJson.errors?.map((e) => e.message).join(' | ') ?? `HTTP ${cfRes.status}`;
    return NextResponse.json(
      { ok: false, errorCode: 'cf_images_upload_failed', details: detail },
      { status: 502 },
    );
  }

  // Use the `thumbnail` variant (200×200 cover) as the avatar URL —
  // exactly the size the 80×80 hero + 56×56 listing-page card paint
  // at any DPR up to 2.5×, with no over-serving. ~10 KiB on the wire.
  const avatarUrl = `https://imagedelivery.net/${pub.NEXT_PUBLIC_CF_IMAGES_HASH}/${cfJson.result.id}/thumbnail`;

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId);
  if (updateErr) {
    console.error('[POST /api/me/avatar] profile update failed', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: 'profile_update_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, avatarUrl }, { status: 201 });
}

export async function DELETE() {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', userResult.user.id);
  if (updateErr) {
    console.error('[DELETE /api/me/avatar] profile update failed', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: 'profile_update_failed' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
