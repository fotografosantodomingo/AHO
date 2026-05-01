import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordPropertyEvent } from '@/lib/listings/events';

export const runtime = 'edge';

/**
 * POST /api/properties/:id/favorite
 *
 * Toggle a buyer-side favorite. Auth-required. The route does the
 * insert-or-delete itself: the body has no `action` field — we look up
 * existing state and flip it. Race-safe because the inserts are
 * idempotent (PK on user_id + property_id) and the delete is
 * idempotent on already-removed rows.
 *
 * Returns `{ ok: true, favorited: boolean }` reflecting the new state.
 *
 * Validation: property must exist + be active+published. Stops users
 * from spam-favoriting a draft they shouldn't see, and from favoriting
 * a property that was deleted but the URL is stale.
 *
 * RLS gates the writes (per migration 0024) — user can only toggle
 * their own row. Service-role NOT used; user-context client is enough.
 */

const ParamSchema = z.object({ id: z.string().uuid() });

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const raw = await params;
  const parsed = ParamSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }
  const propertyId = parsed.data.id;

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;

  // Verify the property is publicly visible. RLS on `properties` already
  // gates non-published rows from anon/non-member users; this lookup
  // both confirms existence + filters out drafts as a belt-and-braces step.
  // Also pulls org_id for the analytics event below.
  const { data: prop, error: propErr } = await supabase
    .from('properties')
    .select('id, status, published_at, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (propErr) {
    console.error('[favorite] property lookup', propErr);
    return NextResponse.json({ ok: false, errorCode: 'lookup_failed' }, { status: 500 });
  }
  if (!prop || prop.status !== 'active' || !prop.published_at) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  // Look up current favorite state via user-context client.
  const { data: existing, error: lookupErr } = await supabase
    .from('property_favorites')
    .select('user_id')
    .eq('user_id', userId)
    .eq('property_id', propertyId)
    .maybeSingle();
  if (lookupErr) {
    console.error('[favorite] lookup', lookupErr);
    return NextResponse.json({ ok: false, errorCode: 'lookup_failed' }, { status: 500 });
  }

  if (existing) {
    const { error } = await supabase
      .from('property_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('property_id', propertyId);
    if (error) {
      console.error('[favorite] delete', error);
      return NextResponse.json({ ok: false, errorCode: 'delete_failed' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, favorited: false });
  }

  const { error: insErr } = await supabase
    .from('property_favorites')
    .insert({ user_id: userId, property_id: propertyId });
  if (insErr) {
    // Race: another tab clicked the same button. Treat unique violation
    // as success — the row is in the desired state.
    if (insErr.code === '23505') {
      return NextResponse.json({ ok: true, favorited: true });
    }
    console.error('[favorite] insert', insErr);
    return NextResponse.json({ ok: false, errorCode: 'insert_failed' }, { status: 500 });
  }

  // Analytics fan-out: favorite_add event. Best-effort; logged on
  // failure. Anonymous_id stays null here — the favorite path is
  // auth-only, so we have a real user_id.
  try {
    await recordPropertyEvent({
      supabase: createAdminClient(),
      propertyId,
      orgId: prop.org_id as string,
      eventType: 'favorite_add',
      userId,
      anonymousId: null,
    });
  } catch (e) {
    console.warn('[favorite] event record failed', e);
  }

  return NextResponse.json({ ok: true, favorited: true });
}
