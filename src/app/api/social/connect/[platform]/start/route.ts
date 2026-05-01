import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUserOrgPlan, isOrgOnProAutomation } from '@/lib/billing/plan-gating';

export const runtime = 'edge';

/**
 * POST /api/social/connect/:platform/start
 *
 * Phase 1 SHELL — entitlement gate only. Real OAuth init lands in
 * Phase 4 (per the social-distribution spec). This route exists now so
 * the locked-UI upgrade flow has somewhere to point and so the gating
 * contract is set in stone before the OAuth handlers are wired.
 *
 * Returns:
 *   - 401 if not signed in
 *   - 403 if signed-in user's org isn't on Pro Automation
 *   - 501 not_implemented otherwise (Phase 4 will replace with real
 *     redirect to the platform's OAuth authorization URL)
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
  if (!ctx) {
    return NextResponse.json({ ok: false, errorCode: 'no_org' }, { status: 403 });
  }

  const ok = await isOrgOnProAutomation(supabase, ctx.orgId);
  if (!ok) {
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
