-- 0061_ai_generation_log.sql
--
-- Per-call AI usage log — Phase 5.5 of docs/SUPER_PRO_STAGE_1_PLAN.md
-- (called out in §5 and §7 as the unit-economics observability table).
--
-- Today the Free Audit pipeline writes aggregate input/output token
-- counts onto `ai_audits.input_tokens` / `output_tokens` columns. Good
-- enough for one row at a time; useless for answering "what's our
-- average cost per audit by market" or "which locale is most expensive
-- per draft" or "did Anthropic invoice us 4× what we expected?"
--
-- This table normalizes per-call. One row per Anthropic API request:
--   - The Free Audit orchestrator's 3 drafter calls (one per locale)
--     each get their own row, plus optionally the importFromUrl call.
--   - The /api/social/ai-draft route (used on real listings) writes
--     one row per draft request.
--
-- Cost estimation lands in a column at write time using a snapshot of
-- the model's per-MTok pricing. If Anthropic changes pricing later,
-- existing rows stay accurate-to-that-moment; new rows pick up the new
-- price via the helper in src/lib/ai/cost.ts.
--
-- Access model: no end-user access. Server-side admin client writes;
-- admin / billing surfaces read via a future SQL view. RLS enabled
-- with NO policies (= deny all to anon/authenticated; only service-role
-- bypasses).

create table public.ai_generation_log (
  id uuid primary key default gen_random_uuid(),
  -- Optional link to the audit that triggered this call. NULL for
  -- real-listing draft requests via /api/social/ai-draft (those are
  -- per-user, not per-audit). FK ON DELETE SET NULL so we keep the
  -- cost record even after the audit row expires + gets pruned.
  audit_id uuid references public.ai_audits(id) on delete set null,
  -- 'audit_import' (importFromUrl, Sonnet) | 'audit_draft' (Haiku per
  -- locale on Free Audit) | 'listing_draft' (Haiku on real listings
  -- via /api/social/ai-draft).
  purpose text not null check (purpose in ('audit_import', 'audit_draft', 'listing_draft')),
  -- Anthropic model id string, e.g. 'claude-haiku-4-5-20251001' or
  -- 'claude-sonnet-4-6-20250508'. Stored verbatim so we don't lose
  -- traceability if we re-version the model later.
  model text not null,
  -- For 'audit_draft' / 'listing_draft' calls: the market dim from
  -- market-prompts.ts (us / es / pl / pt / de / fr / it). NULL for
  -- 'audit_import' since the scraper doesn't think in market terms.
  market text,
  -- Token usage from the Anthropic API response.
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  -- Computed at write time via src/lib/ai/cost.ts using a snapshot of
  -- per-MTok pricing for the model at that moment. Stored in USD cents
  -- so SQL sum + display arithmetic stays in integer territory.
  estimated_cost_usd_cents int not null default 0,
  -- Round-trip latency for SLO tracking + UX budget (Free Audit
  -- promises ≤60s end-to-end; each call's slice matters).
  latency_ms int not null default 0,
  -- NULL on success. Set when the call failed (timeout, rate_limit,
  -- malformed_json, etc.) — same codes as the DrafterResult / route
  -- handlers already use.
  error_code text,
  created_at timestamptz not null default now()
);

comment on table public.ai_generation_log is
  'Per-Anthropic-call usage log for unit economics. Aggregated by daily / per-market / per-purpose rollups in admin/billing surfaces. One row per API request. Per SUPER_PRO_STAGE_1_PLAN.md §5+§7 (target ≤ $0.30/audit).';

-- Most common queries:
--   - "What did this audit cost?" → WHERE audit_id = X
--   - "Daily cost rollup last 30 days" → WHERE created_at > now() - interval '30 days' GROUP BY date_trunc('day', created_at)
--   - "Cost per market" → WHERE market IS NOT NULL GROUP BY market
create index ai_generation_log_audit_id_idx
  on public.ai_generation_log (audit_id)
  where audit_id is not null;
create index ai_generation_log_created_at_idx
  on public.ai_generation_log (created_at desc);
create index ai_generation_log_purpose_market_idx
  on public.ai_generation_log (purpose, market);

alter table public.ai_generation_log enable row level security;

-- No policies = deny-all to anon + authenticated.
-- Service-role client (used by run-audit.ts + ai-draft route) bypasses
-- RLS as designed. End-user surfaces never read this table directly;
-- a future admin SQL view will roll it up.
