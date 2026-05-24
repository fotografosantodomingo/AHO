import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/admin/orgs/[id]/plan-override
 *
 * Admin-only endpoint to grant / extend / revoke a manual plan
 * override on an organization. Used to comp Founding 50 agents +
 * extend soft-beta periods without Stripe.
 *
 * Three actions:
 *
 *   { action: 'grant', plan_id, days | expires_at | permanent, note }
 *     — Sets manual_plan_id + manual_plan_expires_at + stamps grant
 *       provenance. Overwrites any existing override on the org
 *       (operator can re-grant with a different tier/duration).
 *
 *   { action: 'extend', days }
 *     — Pushes manual_plan_expires_at forward by N days. Errors if
 *       there's no active override to extend.
 *
 *   { action: 'revoke' }
 *     — Clears all manual_* fields. The org's effective plan falls
 *       back to current_plan_id (Stripe-derived) on the next read.
 *
 * Every action writes a row to audit_log under kind
 * 'admin.org.plan_comp_<action>' with the full before/after state in
 * the payload, so the operator can pull a per-org history with a
 * single `select * from audit_log where target_id = <org_id>`.
 *
 * Auth gate: profiles.is_admin = true. Service-role bypasses RLS for
 * the write since we've already verified admin.
 */

const ALLOWED_PLAN_IDS = [
  'aho_agent_monthly',
  'aho_agent_annual',
  'aho_agent_founder_monthly',
  'aho_plus_monthly',
  'aho_plus_annual',
  'aho_pro_automation_monthly',
  'aho_pro_automation_annual',
] as const;

const GrantSchema = z
  .object({
    action: z.literal('grant'),
    plan_id: z.enum(ALLOWED_PLAN_IDS),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .and(
    z.union([
      z.object({ days: z.number().int().min(1).max(3650) }),
      z.object({ expires_at: z.string().datetime() }),
      z.object({ permanent: z.literal(true) }),
    ]),
  );

const ExtendSchema = z.object({
  action: z.literal('extend'),
  days: z.number().int().min(1).max(3650),
});

const RevokeSchema = z.object({
  action: z.literal('revoke'),
});

const RequestSchema = z.union([GrantSchema, ExtendSchema, RevokeSchema]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: orgId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    return NextResponse.json({ error: 'invalid_org_id' }, { status: 400 });
  }

  // ─── 1. Admin auth ───────────────────────────────────────────────
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

  // ─── 2. Validate body ────────────────────────────────────────────
  const body = await req.json().catch(() => null);
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const reqData = parsed.data;

  const admin = createAdminClient();

  // ─── 3. Read current state for audit + extend logic ──────────────
  const { data: current, error: readErr } = await admin
    .from('organizations')
    .select('id, name, current_plan_id, manual_plan_id, manual_plan_expires_at, manual_plan_note')
    .eq('id', orgId)
    .maybeSingle();
  if (readErr || !current) {
    return NextResponse.json({ error: 'org_not_found' }, { status: 404 });
  }

  // ─── 4. Compute the patch per action ─────────────────────────────
  const nowIso = new Date().toISOString();
  let patch: Record<string, unknown>;
  let auditKind: string;

  if (reqData.action === 'grant') {
    let expiresAt: string | null;
    if ('permanent' in reqData && reqData.permanent === true) {
      expiresAt = null;
    } else if ('expires_at' in reqData) {
      expiresAt = reqData.expires_at;
    } else if ('days' in reqData) {
      expiresAt = new Date(Date.now() + reqData.days * 86_400_000).toISOString();
    } else {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    patch = {
      manual_plan_id: reqData.plan_id,
      manual_plan_expires_at: expiresAt,
      manual_plan_note: reqData.note ?? null,
      manual_plan_granted_by: userId,
      manual_plan_granted_at: nowIso,
    };
    auditKind = 'admin.org.plan_comp_granted';
  } else if (reqData.action === 'extend') {
    if (!current.manual_plan_id) {
      return NextResponse.json(
        { error: 'no_active_override' },
        { status: 400 },
      );
    }
    // Extend from MAX(now, existing_expires_at). If existing is past,
    // start fresh from now. If existing is null (permanent), error —
    // can't extend a permanent override.
    if (!current.manual_plan_expires_at) {
      return NextResponse.json(
        { error: 'cannot_extend_permanent' },
        { status: 400 },
      );
    }
    const existingMs = Date.parse(current.manual_plan_expires_at as string);
    const baseMs = Number.isFinite(existingMs) && existingMs > Date.now() ? existingMs : Date.now();
    const newExpiresAt = new Date(baseMs + reqData.days * 86_400_000).toISOString();
    patch = {
      manual_plan_expires_at: newExpiresAt,
      manual_plan_granted_by: userId,
      manual_plan_granted_at: nowIso,
    };
    auditKind = 'admin.org.plan_comp_extended';
  } else {
    // revoke
    patch = {
      manual_plan_id: null,
      manual_plan_expires_at: null,
      manual_plan_note: null,
      manual_plan_granted_by: null,
      manual_plan_granted_at: null,
    };
    auditKind = 'admin.org.plan_comp_revoked';
  }

  // ─── 5. Apply the patch ──────────────────────────────────────────
  const { error: updateErr } = await admin
    .from('organizations')
    .update(patch)
    .eq('id', orgId);
  if (updateErr) {
    console.error('[admin/plan-override] update failed', {
      orgId,
      action: reqData.action,
      code: updateErr.code,
      message: updateErr.message,
    });
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // ─── 6. Audit log entry ──────────────────────────────────────────
  // Best-effort — we don't fail the request if the audit insert errors.
  const { error: auditErr } = await admin.from('audit_log').insert({
    kind: auditKind,
    actor_id: userId,
    target_id: orgId,
    payload: {
      action: reqData.action,
      org_name: current.name,
      before: {
        manual_plan_id: current.manual_plan_id,
        manual_plan_expires_at: current.manual_plan_expires_at,
        manual_plan_note: current.manual_plan_note,
        current_plan_id: current.current_plan_id,
      },
      after: patch,
      request: reqData,
    },
  });
  if (auditErr) {
    console.error('[admin/plan-override] audit_log insert failed', {
      orgId,
      code: auditErr.code,
      message: auditErr.message,
    });
  }

  return NextResponse.json({ ok: true, patch });
}
