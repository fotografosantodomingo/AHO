import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/admin/leads/:id/reveal
 *
 * Body: { field: 'email' | 'phone' }
 *
 * Returns the unmasked PII value for one field on one lead AND writes
 * an `audit_log` row recording who revealed what. Click-to-reveal is
 * the trade-off the QA report (#21) recommended over plain-text dumps:
 * masked-by-default protects against admin-account compromise +
 * shoulder-surfing, while the audit log makes any reveal accountable
 * after the fact.
 *
 * Auth model:
 *   - Caller must be a signed-in admin (profiles.is_admin = true).
 *   - The lead read goes through the user-context client; admins have
 *     RLS access (`leads_admin_all` policy) so the same client returns
 *     cross-org leads.
 *   - The audit_log INSERT also goes through the user-context client so
 *     the `audit_log_self_insert` policy enforces actor_id = auth.uid()
 *     (you can't fake another admin's reveal). Service-role is used
 *     only as a defensive fallback if the user-context insert fails.
 *
 * Errors:
 *   - 400 invalid_id / invalid_body
 *   - 401 unauthenticated
 *   - 403 forbidden  (caller is not an admin)
 *   - 404 not_found  (lead doesn't exist or is filtered out by fixture
 *                     scrub; same response avoids leaking which is which)
 *   - 422 no_value   (field is null on the lead — tells the UI to swap
 *                     the masked text for an em-dash instead of a value)
 */

const BodySchema = z.object({
  field: z.enum(['email', 'phone']),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;
  if (!z.string().uuid().safeParse(leadId).success) {
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
  const field = parsed.data.field;

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

  // Read just the field we need plus org_id (for the audit payload —
  // useful when investigating "did this admin look at a competitor's
  // lead?" later). RLS on the user-context client allows admins to
  // SELECT cross-org via `leads_admin_all`.
  const { data: lead, error: readErr } = await supabase
    .from('leads')
    .select('id, org_id, contact_email, contact_phone')
    .eq('id', leadId)
    .maybeSingle();
  if (readErr) {
    console.error('[admin-reveal] read', readErr);
    return NextResponse.json({ ok: false, errorCode: 'db_error' }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  const value = field === 'email' ? lead.contact_email : lead.contact_phone;
  if (!value) {
    return NextResponse.json({ ok: false, errorCode: 'no_value' }, { status: 422 });
  }

  // Audit log first — if the write fails we DO NOT return the value;
  // a reveal that wasn't logged is exactly the failure mode #21 is
  // trying to prevent. Use the user-context client so the
  // `audit_log_self_insert` policy enforces actor_id = auth.uid().
  // Fall back to service-role only as a last resort (RLS hiccup);
  // the actor_id is still correct because we set it explicitly.
  const auditPayload = {
    field,
    org_id: lead.org_id,
  };
  const { error: auditErr } = await supabase.from('audit_log').insert({
    kind: 'admin.lead.pii_reveal',
    actor_id: userResult.user.id,
    target_id: leadId,
    payload: auditPayload,
  });
  if (auditErr) {
    console.warn('[admin-reveal] user-context audit insert failed; retrying via admin client', auditErr);
    const admin = createAdminClient();
    const { error: fallbackErr } = await admin.from('audit_log').insert({
      kind: 'admin.lead.pii_reveal',
      actor_id: userResult.user.id,
      target_id: leadId,
      payload: auditPayload,
    });
    if (fallbackErr) {
      console.error('[admin-reveal] audit insert failed both paths', fallbackErr);
      return NextResponse.json(
        { ok: false, errorCode: 'audit_failed' },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, value });
}
