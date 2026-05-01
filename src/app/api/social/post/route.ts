import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getCurrentUserOrgPlan, isOrgOnProAutomation } from '@/lib/billing/plan-gating';

export const runtime = 'edge';

/**
 * POST /api/social/post
 *
 * Phase 1 SHELL — entitlement gate only. The real flow (Phase 5 +
 * Phase 6 of the social-distribution spec):
 *   1. Validate property ownership + active+published status
 *   2. Validate connected accounts for selected platforms
 *   3. Create social_posts row + per-platform social_post_attempts
 *   4. Queue via Cloudflare Queues
 *   5. Workers post to platform APIs, persist external URLs
 *
 * For now: 403 if not Pro Automation; 501 not_implemented otherwise.
 * Lets the locked-UI button on /dashboard/properties/[id] point at a
 * real endpoint that returns the right error code.
 */
export async function POST(_req: NextRequest) {
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
    { ok: false, errorCode: 'not_implemented', phase: 'posting-engine-phase-6' },
    { status: 501 },
  );
}
