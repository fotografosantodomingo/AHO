/**
 * Mapping from BILLING tier (plan-gating module) → AI gating tier
 * (agent-prompts + gating modules).
 *
 * Extracted from `src/app/api/ai-chat/route.ts` so both the web-chat
 * route and the async-draft scheduler share one definition. Keeping
 * the mapping in a single file ensures that when PO_DECISIONS #2 lands
 * the Super Pro tier price (and a new `aho_super_pro_*` plan id is
 * added to `plan-gating.ts`), only this file needs to add the branch.
 *
 * v1 (per D5=A): AI inbox is bundled into Pro Automation. Agents on
 * Agent / Plus / no-subscription tiers get the SAME prompt-shape (HITL
 * always — autoSendPolicyEnabled=false), so they collapse to 'free'.
 * The `'free'` label is a misnomer here — it means "HITL-required",
 * not "no payment". The AI gating model uses 'free' as its lowest
 * bucket and we keep that vocabulary stable.
 */

import type { planTierLabel } from '@/lib/billing/plan-gating';
import type { AgentTier } from '@/lib/ai/agent-prompts';

export function mapBillingTierToAgentTier(
  billingTier: ReturnType<typeof planTierLabel>,
): AgentTier {
  if (billingTier === 'pro_automation') return 'pro_automation';
  // 'agent' | 'plus' | 'none' → free-tier gating (always HITL). The
  // widget itself still renders on these agents' pages; the AI can
  // generate drafts, but every draft requires the agent to approve
  // via /dashboard/ai-inbox before the buyer-facing widget shows it.
  return 'free';
}
