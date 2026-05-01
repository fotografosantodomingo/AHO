import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * POST /api/listings/:id/archive
 * POST /api/listings/:id/archive?undo=1
 *
 * Soft-delete: flips status to 'archived' (or back to 'draft' on undo).
 * Reversible via the same endpoint with ?undo=1.
 *
 * Both transitions write an audit_log row so we have a paper trail of
 * who archived what when — useful for support requests like "I think
 * one of my agents archived a listing by mistake."
 *
 * RLS gates the UPDATE: org members agent/manager/owner can archive
 * their own org's listings; admins can archive any. A 0-row update
 * with no error means RLS silently filtered → 404.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  const url = new URL(req.url);
  const undo = url.searchParams.get('undo') === '1';
  const newStatus = undo ? 'draft' : 'archived';

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }
  const actorId = userResult.user.id;

  const { data: prior } = await supabase
    .from('properties')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (!prior) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from('properties')
    .update({ status: newStatus })
    .eq('id', id)
    .select('id');

  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[POST /api/listings/:id/archive]', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: updateErr.message ?? 'db_error' },
      { status: 500 },
    );
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  const { error: auditErr } = await supabase.from('audit_log').insert({
    kind: undo ? 'listing.unarchived' : 'listing.archived',
    actor_id: actorId,
    target_id: id,
    payload: { prior_status: prior.status, new_status: newStatus },
  });
  if (auditErr) {
    console.error('[POST /api/listings/:id/archive] audit insert failed', auditErr);
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return NextResponse.json({ ok: true, id });
}
