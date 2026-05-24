import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/admin/users/:id/toggle-admin
 *
 * Body: { makeAdmin: boolean }
 *
 * Promote / demote a user. Replaces the prior `setUserAdmin` server-
 * action path (Server Actions are unreliable on @cloudflare/next-on-
 * pages — same migration applied to listing form, archive button,
 * etc.).
 *
 * Auth model:
 *   - Caller must be a signed-in admin (profiles.is_admin = true).
 *     Verified via the user-context Supabase client.
 *   - The actual UPDATE goes through `createAdminClient()` (service-
 *     role) because `protect_profile_admin_fields` blocks user-context
 *     UPDATEs of is_admin / admin_role (per migration 0002 + 0018).
 *   - Self-demote is rejected: an admin cannot demote themselves
 *     (would let a single misclick orphan the platform's admin set).
 */

const BodySchema = z.object({ makeAdmin: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: targetUserId } = await params;
  if (!z.string().uuid().safeParse(targetUserId).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_body' }, { status: 400 });
  }
  const makeAdmin = parsed.data.makeAdmin;

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (!callerProfile?.is_admin) {
    return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
  }

  if (!makeAdmin && userResult.user.id === targetUserId) {
    return NextResponse.json(
      { ok: false, errorCode: 'cannot_demote_self' },
      { status: 409 },
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({
      is_admin: makeAdmin,
      admin_role: makeAdmin ? 'super_admin' : null,
    })
    .eq('id', targetUserId);
  if (error) {
    console.error('[toggle-admin]', error);
    return NextResponse.json(
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }

  revalidatePath('/[locale]/admin/users', 'page');
  return NextResponse.json({ ok: true, id: targetUserId, isAdmin: makeAdmin });
}
