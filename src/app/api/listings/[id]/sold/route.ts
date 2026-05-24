import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { buildSoldAuditPayload } from '@/lib/audit/audit-payload';

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

  // Existence/auth check via RLS-aware read; we don't include any
  // captured fields in the audit payload (see lib/audit/audit-payload.ts
  // — payload is restricted to public-safe lifecycle facts only).
  const { data: prior } = await supabase
    .from('properties')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (!prior) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  const soldDate = data.sold_date ?? new Date().toISOString();
  const update: Record<string, unknown> = {
    status: data.status,
    sold_date: soldDate,
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
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }

  // Append-only audit row. Payload is anon-readable via the 0014 RLS
  // policy for kind in (listing.marked_sold, listing.marked_rented),
  // so it MUST contain only public-safe fields. closing_notes and
  // prior_status are intentionally excluded; see lib/audit/audit-payload.ts.
  const { error: auditErr } = await supabase.from('audit_log').insert({
    kind: data.status === 'rented' ? 'listing.marked_rented' : 'listing.marked_sold',
    actor_id: actorId,
    target_id: id,
    payload: buildSoldAuditPayload({
      status: data.status,
      soldDate,
      soldPriceCents: data.sold_price_cents,
      representedSide: data.represented_side,
    }),
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
