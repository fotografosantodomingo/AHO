-- 0073_ai_conversation_tier_snapshot.sql
--
-- Add `tier_at_creation` to `ai_conversations` so adoption-by-tier
-- queries survive a tier change. Without this, when an agent upgrades
-- from Plus to Pro Automation mid-week, all their PRIOR-tier
-- conversations get re-attributed to Pro Automation by any
-- `join organizations on current_plan_id` query — losing the signal
-- "agents on Pro Automation use the AI 3x more than agents on Plus".
--
-- Snapshot is captured at conversation creation via the API layer
-- (the route already resolves the agent's tier for the gating model;
-- now it ALSO writes that label into this column).
--
-- Default 'unknown' covers all existing rows (created before this
-- migration); the column is nullable-default-string rather than NULL
-- so dashboard tables can group/filter without coalesce.

alter table public.ai_conversations
  add column if not exists tier_at_creation text not null default 'unknown';

-- Index for the per-tier rollup (admin view's "adoption by tier" chart).
create index if not exists idx_ai_conv_tier_created
  on public.ai_conversations(tier_at_creation, first_message_at);

comment on column public.ai_conversations.tier_at_creation is
  'Billing tier label at the moment the conversation was created. Captured by the API layer using mapBillingTierToAgentTier(). Stays correct even if the agent later upgrades / downgrades, so adoption-by-tier rollups in /admin/ai-overview measure true at-the-time behavior. Values: free | pro_automation | super_pro | agency | unknown.';
