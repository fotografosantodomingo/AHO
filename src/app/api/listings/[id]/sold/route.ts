import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * POST /api/listings/:id/sold
 *
 * Mark a listing as sold (or rented). Writes the sold-side fields and
 * a row to audit_log so the property page's price-history block and
 * the agent's audit trail share one ledger. The
 * `recompute_agent_stats` trigger on properties handles the stats
 * cache repopulation automatically — auth-context-agnostic, so admin-
 * driven flips also recompute the right agent's tiles.
 *
 * sold_date defaults to now() if omitted (the trigger fills it in).
 * sold_price_cents is OPTIONAL — confidential closings are legitimate
 * and we don't want agents inventing numbers.
 *
 * Body:
 *   { sold_date?: string ISO, sold_price_cents?: number,
 *     represented_side?: 'buyer'|'seller'|'both', closing_notes?: string,
 *     status?: 'sold'|'rented' (default 'sold') }
 */

const SoldSchema = z.object({
  sold_date: z.string().datetime().optional(),
  sold_price_cents: z.number().int().positive().max(9_999_999_999_999).optional().nullable(),
  represented_side: z.enum(['buyer', 'seller', 'both']).optional().nullable(),
  closing_notes: z.string().trim().max(2000).optional().nullable(),
  status: z.enum(['sold', 'rented']).optional().default('sold'),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = SoldSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_input', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }
  const actorId = userResult.user.id;

  // Capture prior status for the audit log payload.
  const { data: prior } = await supabase
    .from('properties')
    .select('status, sold_date, sold_price_cents, represented_side')
    .eq('id', id)
    .maybeSingle();
  if (!prior) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    status: data.status,
    sold_date: data.sold_date ?? new Date().toISOString(),
  };
  if (data.sold_price_cents !== undefined) update.sold_price_cents = data.sold_price_cents;
  if (data.represented_side !== undefined) update.represented_side = data.represented_side;
  if (data.closing_notes !== undefined) update.closing_notes = data.closing_notes;

  const { error: updateErr } = await supabase
    .from('properties')
    .update(update)
    .eq('id', id);

  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[POST /api/listings/:id/sold]', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: updateErr.message ?? 'db_error' },
      { status: 500 },
    );
  }

  // Append-only audit row. RLS allows authenticated users to insert
  // rows where actor_id = auth.uid(). Cheap; one INSERT.
  const { error: auditErr } = await supabase.from('audit_log').insert({
    kind: data.status === 'rented' ? 'listing.marked_rented' : 'listing.marked_sold',
    actor_id: actorId,
    target_id: id,
    payload: {
      prior_status: prior.status,
      sold_date: update.sold_date,
      sold_price_cents: data.sold_price_cents ?? null,
      represented_side: data.represented_side ?? null,
      closing_notes: data.closing_notes ?? null,
    },
  });
  if (auditErr) {
    // Audit failure shouldn't unwind the sold flip — the listing IS
    // sold. Just log.
    console.error('[POST /api/listings/:id/sold] audit insert failed', auditErr);
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  revalidatePath('/[locale]/agents/[slug]', 'page');
  return NextResponse.json({ ok: true, id });
}
