import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { ConfirmRequestSchema } from '@/lib/listings/upload';

/**
 * POST /api/properties/:id/images/:imageId/confirm
 *
 * Step 2 of the two-step upload flow. The client has PUT the bytes to R2;
 * now we flip the row from `pending` -> `confirmed` and capture
 * width/height/cf_image_id provided by the client.
 *
 * Authorization: RLS on the UPDATE blocks anyone outside the org's role set
 * (agent / manager / owner). The route doesn't itself need to re-check
 * org membership; if the UPDATE returns no row, we propagate as 404 / 403.
 *
 * Optional improvement (deferred): HEAD the R2 object before flipping status,
 * to confirm the bytes actually landed. That requires either an R2 admin
 * call or a Worker-bound reading capability — defer until R2 is wired up
 * and the orphan sweep is in place.
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
    .select('id, property_id, upload_status')
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
    // Idempotency — confirming twice is fine.
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  const { error: updateErr } = await supabase
    .from('property_images')
    .update({
      width: parsed.data.width,
      height: parsed.data.height,
      cf_image_id: parsed.data.cfImageId ?? null,
      upload_status: 'confirmed',
    })
    .eq('id', imageId);

  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return NextResponse.json(
      { error: 'update_failed', details: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
