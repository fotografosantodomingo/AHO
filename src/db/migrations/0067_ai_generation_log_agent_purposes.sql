-- 0067_ai_generation_log_agent_purposes.sql
--
-- Relax the `purpose` CHECK constraint on ai_generation_log to admit
-- the two new AI-customer-service-agent purpose values:
--   - 'ai_agent_converse'  — the main Claude orchestrator call per
--                             conversation turn (src/lib/ai/converse.ts)
--   - 'ai_agent_classify'  — optional v2 Haiku call for the gating
--                             classifier (src/lib/ai/gating.ts heuristic
--                             v1 doesn't need it; v2 will)
--
-- Without this migration, the inserts from `logAiCall` for those
-- purposes hit postgrest error 23514 (check_violation) and the row is
-- lost (logAiCall swallows + console.errors per its design contract).
-- The conversation itself isn't affected — just the cost observability.
-- Lands alongside migration 0066 so cost rollups capture AI-agent
-- traffic from day one of Phase 1.

alter table public.ai_generation_log
  drop constraint if exists ai_generation_log_purpose_check;

alter table public.ai_generation_log
  add constraint ai_generation_log_purpose_check
  check (purpose in (
    'audit_import',
    'audit_draft',
    'listing_draft',
    'ai_agent_converse',
    'ai_agent_classify'
  ));
