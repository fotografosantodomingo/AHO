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

/** Returns the org's current_plan_id, or null if no subscription. */
export async function getOrgPlanId(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('current_plan_id')
    .eq('id', orgId)
    .maybeSingle();
  if (error) {
    console.warn('[plan-gating] org plan lookup failed', error);
    return null;
  }
  return (data?.current_plan_id as string | null) ?? null;
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
