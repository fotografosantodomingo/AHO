import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ConfirmRequestSchema } from '@/lib/listings/upload';
import { publicEnv, serverEnv } from '@/lib/env';

export const runtime = 'edge';

interface CfUploadResponse {
  success: boolean;
  errors?: Array<{ message: string }>;
  result?: { id: string };
}

/**
 * Server-side relay of an R2 object into Cloudflare Images. Returns
 * the new CF Images id, or null on failure (caller logs + falls back
 * to the existing R2-only confirm path; the periodic backfill script
 * picks up rows without cf_image_id later).
 *
 * Why this lives here and not in `lib/cf-images/`: the confirm endpoint
 * is currently the only server-side caller — the avatar route does its
 * own multipart-direct upload. If a third caller appears, lift to a
 * shared module.
 */
async function pushR2ToCfImages(args: {
  r2Key: string;
  propertyId: string;
  imageId: string;
}): Promise<string | null> {
  const env = serverEnv();
  const pub = publicEnv();
  if (
    !env.CLOUDFLARE_API_TOKEN ||
    !env.CLOUDFLARE_ACCOUNT_ID ||
    !pub.NEXT_PUBLIC_R2_PUBLIC_URL
  ) {
    return null;
  }
  const r2Url = `${pub.NEXT_PUBLIC_R2_PUBLIC_URL.replace(/\/$/, '')}/${args.r2Key}`;
  const resR2 = await fetch(r2Url);
  if (!resR2.ok) {
    console.warn(`[confirm] R2 fetch ${r2Url} failed: ${resR2.status}`);
    return null;
  }
  const blob = await resR2.blob();
  const filename = args.r2Key.split('/').pop() ?? `${args.imageId}.jpg`;

  const fd = new FormData();
  fd.append('file', blob, filename);
  fd.append(
    'metadata',
    JSON.stringify({
      property_image_id: args.imageId,
      property_id: args.propertyId,
      r2_key: args.r2Key,
      uploaded_via: 'confirm-relay',
    }),
  );
  fd.append('requireSignedURLs', 'false');

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      body: fd,
    },
  );
  const json = (await cfRes.json()) as CfUploadResponse;
  if (!cfRes.ok || !json.success || !json.result?.id) {
    const detail = json.errors?.map((e) => e.message).join(' | ') ?? `HTTP ${cfRes.status}`;
    console.warn(`[confirm] CF Images push failed for ${args.r2Key}: ${detail}`);
    return null;
  }
  return json.result.id;
}

/**
 * POST /api/properties/:id/images/:imageId/confirm
 *
 * Step 2 of the two-step upload flow. The client has PUT the bytes to R2;
 * now we relay the R2 object into Cloudflare Images and flip the row from
 * `pending` -> `confirmed` with width / height / cf_image_id captured in a
 * single UPDATE.
 *
 * The CF Images relay is best-effort. If the push fails (CF outage,
 * temporary R2 read issue, etc.) we still flip the row to confirmed so
 * the listing isn't held back; the existing
 * `scripts/backfill-r2-to-cf-images.ts` job picks up cf_image_id-null
 * rows on its next run.
 *
 * Authorization: RLS on the UPDATE blocks anyone outside the org's role
 * set (agent / manager / owner). The route doesn't itself need to
 * re-check org membership; if the UPDATE returns no row, we propagate
 * as 404 / 403.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const { id: propertyId, imageId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = ConfirmRequestSchema.safeParse(body);
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

  // Sanity-check the image belongs to this property and is currently pending.
  const { data: image, error: lookupErr } = await supabase
    .from('property_images')
    .select('id, property_id, r2_key, upload_status')
    .eq('id', imageId)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!image) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (image.property_id !== propertyId) {
    return NextResponse.json({ error: 'mismatch' }, { status: 400 });
  }
  if (image.upload_status === 'confirmed') {
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  // Best-effort push to Cloudflare Images. If it succeeds we capture
  // cf_image_id in the same UPDATE; if not, we still confirm the row
  // and let the backfill script pick it up later.
  let cfImageId: string | null = parsed.data.cfImageId ?? null;
  if (!cfImageId && image.r2_key) {
    cfImageId = await pushR2ToCfImages({
      r2Key: image.r2_key as string,
      propertyId,
      imageId,
    });
  }

  const { error: updateErr } = await supabase
    .from('property_images')
    .update({
      width: parsed.data.width,
      height: parsed.data.height,
      cf_image_id: cfImageId,
      upload_status: 'confirmed',
    })
    .eq('id', imageId);

  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    console.error('[POST images/confirm] update_failed', updateErr);
    return NextResponse.json(
      { error: 'update_failed' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, cfImageId });
}
