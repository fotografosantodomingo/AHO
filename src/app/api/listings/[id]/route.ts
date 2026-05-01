import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * DELETE /api/listings/:id
 *
 * Delete a listing (any status). Org owners can delete; agents can
 * delete listings they created (RLS `properties_org_member_delete`
 * policy from migration 0004). Admins can delete anything.
 *
 * The `property_images` rows cascade-delete via the FK from 0004; the
 * R2 objects themselves are NOT deleted by this endpoint (orphan sweep
 * is a separate cron — out of scope today). Listing rows are gone from
 * the DB immediately, so the public listing 404s and the dashboard
 * stops showing it.
 *
 * Response shape:
 *   - 200 { ok: true, id }
 *   - 400 { ok: false, errorCode: 'invalid_id' }
 *   - 401 { ok: false, errorCode: 'unauthenticated' }
 *   - 403 { ok: false, errorCode: 'forbidden' }
 *   - 404 { ok: false, errorCode: 'not_found' }
 *   - 500 { ok: false, errorCode }
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_id' },
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

  // RLS gates the delete; we use `select` after to detect "not found"
  // vs "denied" — a 0-row result with no error means RLS silently
  // filtered the row out (didn't belong to this user).
  const { data: deleted, error: delErr } = await supabase
    .from('properties')
    .delete()
    .eq('id', id)
    .select('id');

  if (delErr) {
    if (delErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[DELETE /api/listings/:id]', delErr);
    return NextResponse.json(
      { ok: false, errorCode: delErr.message ?? 'db_error' },
      { status: 500 },
    );
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return NextResponse.json({ ok: true, id });
}
