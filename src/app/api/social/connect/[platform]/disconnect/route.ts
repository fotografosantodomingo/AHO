import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUserOrgPlan, isOrgOnProAutomation } from '@/lib/billing/plan-gating';

export const runtime = 'edge';

/**
 * POST /api/social/connect/:platform/disconnect
 *
 * Phase 1 SHELL — entitlement gate only. Real disconnect (revoke token,
 * mark social_accounts row inactive) lands in Phase 4. This shell
 * enforces 403 on lower plans now so the contract is locked.
 */
const ALLOWED_PLATFORMS = ['facebook', 'instagram', 'linkedin'] as const;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  if (!(ALLOWED_PLATFORMS as readonly string[]).includes(platform)) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_platform' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }

  const ctx = await getCurrentUserOrgPlan(supabase);
  if (!ctx || !(await isOrgOnProAutomation(supabase, ctx.orgId))) {
    return NextResponse.json(
      { ok: false, errorCode: 'plan_required', requiredPlan: 'pro_automation' },
      { status: 403 },
    );
  }

  return NextResponse.json(
    { ok: false, errorCode: 'not_implemented', phase: 'oauth-phase-4' },
    { status: 501 },
  );
}
