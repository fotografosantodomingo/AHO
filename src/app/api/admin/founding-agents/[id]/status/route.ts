import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/admin/founding-agents/[id]/status
 *
 * Admin-only status + notes update for a single Founding 50
 * application. Auth gate: the user-context client checks
 * profiles.is_admin BEFORE the service-role patch goes through.
 *
 * Status transitions trigger timestamp side-effects:
 *   applied → contacted       sets contacted_at = now()
 *   * → converted             sets converted_at = now()
 *
 * Other transitions leave the timestamps alone (operator can re-edit
 * notes without bumping timestamps).
 */

const PatchSchema = z.object({
  status: z.enum(['applied', 'contacted', 'onboarding', 'converted', 'declined']),
  notes: z.string().max(4000).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }

  // ─── 1. Auth — must be an admin user ───────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ─── 2. Parse + validate ────────────────────────────────────────
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { status, notes } = parsed.data;

  // ─── 3. Read current row for transition-side-effects ────────────
  const admin = createAdminClient();
  const { data: current } = await admin
    .from('founding_agent_applications')
    .select('id, status, contacted_at, converted_at')
    .eq('id', id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // ─── 4. Build the patch ──────────────────────────────────────────
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status,
    operator_notes: notes ?? null,
  };

  // First time moving to contacted: stamp contacted_at.
  if (
    status === 'contacted' &&
    !current.contacted_at &&
    current.status !== 'contacted'
  ) {
    patch.contacted_at = nowIso;
  }
  // First time moving to converted: stamp converted_at.
  if (
    status === 'converted' &&
    !current.converted_at &&
    current.status !== 'converted'
  ) {
    patch.converted_at = nowIso;
  }

  const { error: updateErr } = await admin
    .from('founding_agent_applications')
    .update(patch)
    .eq('id', id);

  if (updateErr) {
    console.error('[admin/founding-agents/status] update failed', {
      id,
      code: updateErr.code,
      message: updateErr.message,
    });
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
