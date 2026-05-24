import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Plan-gating helpers for the social-automation feature
 * (feat/pro-automation-social-distribution).
 *
 * Tier model — id-based, NO Stripe restructure:
 *   aho_agent_monthly / aho_agent_annual / aho_agent_founder_monthly
 *     → "Agent" tier ($29 / $290 / $19) — no social automation
 *   aho_plus_monthly / aho_plus_annual
 *     → "Plus" tier ($49 / $490) — no social automation
 *   aho_pro_automation_monthly / aho_pro_automation_annual
 *     → "Pro Automation" tier ($99 / $990) — UNLOCKED social automation
 *
 * Source of truth: `organizations.current_plan_id` (denormalized from
 * the active subscription via the trigger from migration 0007). Stays
 * in sync with Stripe via the `customer.subscription.updated` webhook.
 *
 * Usage:
 *
 *   import { isOrgOnProAutomation, requireProAutomation } from '@/lib/billing/plan-gating';
 *
 *   // In a Server Component:
 *   const unlocked = await isOrgOnProAutomation(supabase, orgId);
 *
 *   // In an API route:
 *   const ok = await requireProAutomation(supabase, orgId);
 *   if (!ok) return NextResponse.json({ ok: false, errorCode: 'plan_required' }, { status: 403 });
 */

/** Plan IDs that unlock the social-automation feature. */
export const PRO_AUTOMATION_PLAN_IDS = [
  'aho_pro_automation_monthly',
  'aho_pro_automation_annual',
] as const;

/** All paid tiers that an org can be on. Used for showing locked-state
 *  upsell vs. "you have no subscription at all" vs. "you have it" branches. */
export const ANY_PAID_PLAN_IDS = [
  'aho_agent_monthly',
  'aho_agent_annual',
  'aho_agent_founder_monthly',
  'aho_plus_monthly',
  'aho_plus_annual',
  'aho_pro_automation_monthly',
  'aho_pro_automation_annual',
] as const;

/**
 * Returns the org's EFFECTIVE plan id, or null if no plan.
 *
 * Precedence:
 *   1. `manual_plan_id` (admin-granted comp) if non-NULL AND
 *      (manual_plan_expires_at IS NULL OR > now()) — i.e. active
 *      override. This is how the operator comps founding agents +
 *      soft-beta agents without going through Stripe.
 *   2. `current_plan_id` — the Stripe-derived plan from the
 *      subscription webhook (source of truth for paid customers).
 *
 * NULL when neither applies (truly no plan).
 *
 * Implementation: a single SELECT pulls both fields. Override
 * eligibility resolves in JS — `now()` is the request's wall clock,
 * which is fine since plan checks are not nanosecond-sensitive.
 */
export async function getOrgPlanId(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('current_plan_id, manual_plan_id, manual_plan_expires_at')
    .eq('id', orgId)
    .maybeSingle();
  if (error) {
    console.warn('[plan-gating] org plan lookup failed', error);
    return null;
  }
  return resolveEffectivePlanId({
    currentPlanId: (data?.current_plan_id as string | null) ?? null,
    manualPlanId: (data?.manual_plan_id as string | null) ?? null,
    manualPlanExpiresAt: (data?.manual_plan_expires_at as string | null) ?? null,
  });
}

/**
 * Pure function: given the three plan fields on `organizations`,
 * return the effective plan id. Extracted from getOrgPlanId so it
 * can be unit-tested without a Supabase client.
 */
export function resolveEffectivePlanId(args: {
  currentPlanId: string | null;
  manualPlanId: string | null;
  /** ISO 8601 timestamp string OR null (permanent override). */
  manualPlanExpiresAt: string | null;
}): string | null {
  if (args.manualPlanId) {
    if (args.manualPlanExpiresAt === null) {
      // Permanent override — used for Founding 50 founder rates.
      return args.manualPlanId;
    }
    const expires = Date.parse(args.manualPlanExpiresAt);
    if (Number.isFinite(expires) && expires > Date.now()) {
      return args.manualPlanId;
    }
    // Override expired — fall through to Stripe-derived plan.
  }
  return args.currentPlanId;
}

/** True if the org's current plan is Pro Automation (monthly OR annual). */
export async function isOrgOnProAutomation(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  const planId = await getOrgPlanId(supabase, orgId);
  if (!planId) return false;
  return (PRO_AUTOMATION_PLAN_IDS as readonly string[]).includes(planId);
}

/**
 * For API routes: returns true if the org can use Pro Automation
 * features. False otherwise; the caller should return 403.
 *
 * Pure helper — no logging, no response shape. Caller decides the
 * 403 body.
 */
export async function requireProAutomation(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  return isOrgOnProAutomation(supabase, orgId);
}

/**
 * Resolve the plan id for the signed-in user's first owned org. Server
 * Component path — pulls from the user-context Supabase client.
 *
 * Returns null if:
 *   - User is not signed in
 *   - User has no org membership
 *   - The org has no current_plan_id (no active subscription)
 */
export async function getCurrentUserOrgPlan(
  supabase: SupabaseClient,
): Promise<{ orgId: string; planId: string | null } | null> {
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return null;
  const { data, error } = await supabase
    .from('organization_members')
    .select('org_id, organizations!inner(current_plan_id)')
    .eq('user_id', userResult.user.id)
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const orgId = data.org_id as string;
  // Supabase JS infers the embedded join's shape loosely; cast safely.
  const planId =
    (data as unknown as { organizations: { current_plan_id: string | null } })
      .organizations.current_plan_id ?? null;
  return { orgId, planId };
}

/**
 * Display-mapping helpers — turn a plan_id into a tier label for UI.
 */
export function planTierLabel(planId: string | null): 'agent' | 'plus' | 'pro_automation' | 'none' {
  if (!planId) return 'none';
  if (planId.startsWith('aho_pro_automation')) return 'pro_automation';
  if (planId.startsWith('aho_plus')) return 'plus';
  if (planId.startsWith('aho_agent')) return 'agent';
  return 'none';
}
