import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serverEnv } from '@/lib/env';
import { presignPut } from '@/lib/storage/r2';
import {
  UploadRequestSchema,
  buildR2Key,
  checkImageCap,
} from '@/lib/listings/upload';

export const runtime = 'edge';

/**
 * POST /api/properties/:id/images
 *
 * Step 1 of the two-step image upload flow.
 *   - Authenticated user must be a member of the property's org with
 *     role agent / manager / owner (RLS enforces this on the INSERT).
 *   - Validates content type and image cap (30 per property).
 *   - Inserts a `property_images` row with `upload_status = 'pending'`.
 *   - Returns a 5-minute presigned PUT URL the client uses to upload bytes
 *     directly to R2.
 *
 * Step 2 is `POST /api/properties/:id/images/:imageId/confirm`.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: propertyId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = UploadRequestSchema.safeParse(body);
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

  // RLS will block reads of properties the user can't see, so this acts as
  // both an existence check and an authorization check.
  const { data: property, error: propertyErr } = await supabase
    .from('properties')
    .select('id, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (propertyErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!property) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Cap check — count current images (any status) for this property.
  const { count, error: countErr } = await supabase
    .from('property_images')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId);
  if (countErr) {
    return NextResponse.json({ error: 'count_failed' }, { status: 500 });
  }
  const cap = checkImageCap(count ?? 0);
  if (!cap.ok) {
    return NextResponse.json(
      { error: 'image_cap_reached', limit: cap.limit, current: cap.current },
      { status: 409 },
    );
  }

  const env = serverEnv();
  if (!env.R2_BUCKET_PROPERTY_IMAGES) {
    return NextResponse.json(
      { error: 'r2_not_configured' },
      { status: 503 },
    );
  }

  const imageId = crypto.randomUUID();
  const r2Key = buildR2Key(propertyId, imageId, parsed.data.contentType);

  // Insert pending row. RLS WITH CHECK validates the user's org membership.
  const { error: insertErr } = await supabase.from('property_images').insert({
    id: imageId,
    property_id: propertyId,
    r2_key: r2Key,
    alt_text_en: parsed.data.altTextEn ?? null,
    alt_text_es: parsed.data.altTextEs ?? null,
    position: parsed.data.position ?? cap.current,
    is_primary: parsed.data.isPrimary ?? false,
    upload_status: 'pending',
  });
  if (insertErr) {
    if (insertErr.code === '42501') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      { error: 'insert_failed', details: insertErr.message },
      { status: 500 },
    );
  }

  // Sign the upload URL.
  let signed;
  try {
    signed = await presignPut({
      bucket: env.R2_BUCKET_PROPERTY_IMAGES,
      key: r2Key,
      contentType: parsed.data.contentType,
    });
  } catch (e) {
    // Roll back the pending row if signing fails — orphan sweep would handle it,
    // but explicit cleanup keeps the state simpler.
    await supabase.from('property_images').delete().eq('id', imageId);
    return NextResponse.json(
      { error: 'sign_failed', details: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      imageId,
      r2Key,
      uploadUrl: signed.uploadUrl,
      expiresAt: signed.expiresAt,
      method: 'PUT',
      headers: {
        'Content-Type': parsed.data.contentType,
      },
    },
    { status: 201 },
  );
}
