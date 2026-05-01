import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * POST /api/listings/:id/publish
 *
 * Flip a draft listing's status to active. Replaces the previous
 * Server Action path (`publishListing` in `src/lib/listings/actions.ts`).
 *
 * Auth: signed-in org member (RLS allows agent / manager / owner UPDATE
 * via `properties_org_member_update`). The listing-cap trigger from
 * 0005 raises `listing_cap_exceeded` if publishing this listing would
 * push the org over its cap; we surface that as a 403 with a stable
 * error code.
 *
 * Body: none.
 *
 * Response shape:
 *   - 200 { ok: true, id }
 *   - 400 { ok: false, errorCode: 'invalid_id' }
 *   - 401 { ok: false, errorCode: 'unauthenticated' }
 *   - 403 { ok: false, errorCode: 'listing_cap_exceeded' | 'forbidden' }
 *   - 500 { ok: false, errorCode }
 */
export async function POST(
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

  const { error: updateErr } = await supabase
    .from('properties')
    .update({
      status: 'active',
      published_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) {
    // Listing-cap trigger raises an exception with the literal text
    // 'listing_cap_exceeded' (per migration 0005). Surface it as a
    // stable code regardless of whether postgres-js wraps the error.
    if (
      updateErr.message?.includes('listing_cap_exceeded') ||
      updateErr.code === 'P0001'
    ) {
      return NextResponse.json(
        { ok: false, errorCode: 'listing_cap_exceeded' },
        { status: 403 },
      );
    }
    if (updateErr.code === '42501') {
      return NextResponse.json(
        { ok: false, errorCode: 'forbidden' },
        { status: 403 },
      );
    }
    console.error('[POST /api/listings/:id/publish] update failed', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: updateErr.message ?? 'db_error' },
      { status: 500 },
    );
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return NextResponse.json({ ok: true, id });
}
