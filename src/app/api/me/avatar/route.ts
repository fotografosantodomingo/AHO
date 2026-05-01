import { NextResponse, type NextRequest } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { publicEnv, serverEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/me/avatar
 *
 * Multipart upload of a profile photo for the signed-in user. Direct
 * server-side PUT to R2 (avatar files are small enough — ≤2 MB — to fit
 * in an edge-runtime request body without justifying the presigned-URL
 * dance the property-image flow uses).
 *
 * Constraints:
 *   - Auth required (anon → 401)
 *   - byteSize ≤ 2_000_000 (~2 MB) — server-side enforced; the client
 *     UI should also gate but this is the trust boundary
 *   - contentType ∈ { image/jpeg, image/png, image/webp } — server-side
 *     allowlist; client-side accept attribute is UX, not security
 *   - Object key: `avatars/{userId}/{timestamp}-{random}.{ext}` so each
 *     upload gets a unique URL (cache-busts old image URLs that may
 *     still be referenced from cached SSR pages)
 *
 * Side effect: updates `profiles.avatar_url` to the new public URL.
 * Old avatar objects become orphans in R2 (cleanup is a separate
 * concern — the previous URL stops being referenced once the row
 * updates).
 *
 * DELETE /api/me/avatar removes the avatar_url (no R2 deletion — see
 * orphan note above).
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 2_000_000;

function extFor(contentType: string): string {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'bin';
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
  if (!env.R2_BUCKET_PROPERTY_IMAGES || !env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return NextResponse.json(
      { ok: false, errorCode: 'r2_not_configured' },
      { status: 503 },
    );
  }
  const pub = publicEnv();
  if (!pub.NEXT_PUBLIC_R2_PUBLIC_URL) {
    return NextResponse.json(
      { ok: false, errorCode: 'r2_public_url_missing' },
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

  const ext = extFor(contentType);
  const key = `avatars/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

  const client = new S3Client({
    endpoint: env.R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_PROPERTY_IMAGES,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // Avatars are public — the bucket is fronted by a public URL.
        // Cache for a long time; the timestamped key cache-busts on
        // each new upload.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'r2_put_failed',
        details: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  const avatarUrl = `${pub.NEXT_PUBLIC_R2_PUBLIC_URL.replace(/\/$/, '')}/${key}`;

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', userId);
  if (updateErr) {
    return NextResponse.json(
      { ok: false, errorCode: 'profile_update_failed', details: updateErr.message },
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
    return NextResponse.json(
      { ok: false, errorCode: 'profile_update_failed', details: updateErr.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
