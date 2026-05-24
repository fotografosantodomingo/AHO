import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * PATCH /api/properties/:id/images/:imageId
 *
 * Lets the listing owner update SEO/a11y metadata on an already-uploaded
 * image: alt text per locale, optional caption per locale. RLS gates
 * write access via `property_images_org_member_update` (member of the
 * owning org). Status code semantics:
 *   - 200 { ok: true } on success
 *   - 400 { ok: false, errorCode: 'invalid_request' | 'invalid_ids' }
 *   - 401 { ok: false, errorCode: 'unauthenticated' }
 *   - 403 { ok: false, errorCode: 'forbidden' } (RLS denied)
 *   - 500 on db failure
 *
 * Why a separate route from the existing POST/confirm flow: those are
 * upload-stage operations (create row + push bytes). Alt-text editing
 * happens AFTER the photo is confirmed — different lifecycle, different
 * gate (any org member with the listing edit policy can update text;
 * not just the uploader). Keeping them in separate routes makes RLS
 * + audit clean.
 */

const PatchBodySchema = z.object({
  altTextEn: z.string().max(300).optional().nullable(),
  altTextEs: z.string().max(300).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> },
): Promise<NextResponse> {
  const { id: propertyId, imageId } = await params;
  if (!z.string().uuid().safeParse(propertyId).success || !z.string().uuid().safeParse(imageId).success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_ids' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_request' },
      { status: 400 },
    );
  }

  // Build the patch payload — only set keys the caller sent. `null`
  // explicitly clears the text (agent wants to remove); `undefined`
  // means "don't touch". The Zod .optional().nullable() chain
  // distinguishes both.
  const patch: Record<string, string | null> = {};
  if ('altTextEn' in parsed.data) patch.alt_text_en = parsed.data.altTextEn ?? null;
  if ('altTextEs' in parsed.data) patch.alt_text_es = parsed.data.altTextEs ?? null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, noop: true });
  }

  const { error } = await supabase
    .from('property_images')
    .update(patch)
    .eq('id', imageId)
    .eq('property_id', propertyId);
  if (error) {
    if (error.code === '42501') {
      return NextResponse.json(
        { ok: false, errorCode: 'forbidden' },
        { status: 403 },
      );
    }
    console.error('[PATCH images/:imageId] update failed', error);
    return NextResponse.json(
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
