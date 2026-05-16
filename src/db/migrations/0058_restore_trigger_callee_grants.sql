-- 0058_restore_trigger_callee_grants.sql
--
-- Restore EXECUTE on functions called *from inside* trigger bodies via
-- PERFORM / SELECT. Migration 0049 revoked these on the (incorrect)
-- assumption that "triggers execute as the table owner, EXECUTE doesn't
-- matter." That premise holds for the trigger function ITSELF (Postgres
-- invokes it via the trigger machinery without an EXECUTE check on the
-- caller), but NOT for any function the trigger body subsequently calls
-- — that subsequent call resolves through the regular permissions system
-- and requires the SQL-statement-issuing role (here: `authenticated` for
-- any RLS-protected UPDATE) to hold EXECUTE on the callee.
--
-- Symptom that surfaced 2026-05-16 publish flow:
--   PO michal@babulashots.pl (org owner, authenticated) → UPDATE properties
--   → BEFORE UPDATE trigger `trigger_recompute_agent_stats` fires
--   → trigger body does PERFORM public.recompute_agent_stats(v_old_agent)
--   → permission denied for function recompute_agent_stats (42501)
--   → publish handler maps 42501 → "forbidden" → user sees
--     "You don't have permission to publish this listing"
--
-- Functions to restore (both follow the same trigger-callee pattern):
--   - recompute_agent_stats(uuid)
--       Called from trigger_recompute_agent_stats on properties UPDATE
--   - recompute_org_current_subscription(uuid)
--       Called from refresh_org_current_subscription_trigger on
--       subscriptions UPDATE
--
-- Both are SECURITY DEFINER so they run as their owner regardless of
-- caller; the EXECUTE grant is purely a gating check. Restoring it
-- doesn't change what the functions can DO — only restores the gate
-- the trigger needs to pass through.
--
-- We keep the original 0049 intent of NOT exposing these via the public
-- PostgREST RPC surface: PostgREST surfaces SECURITY DEFINER functions
-- under /rest/v1/rpc/{name} only when they're in the `public` schema
-- AND callable by the role. With EXECUTE granted these become callable
-- — anyone with the anon key could POST /rest/v1/rpc/recompute_agent_stats
-- and trigger a recompute. That's low-risk (idempotent denormalization
-- update, no privilege escalation) but not zero. We accept the tradeoff
-- because the alternative is broken UPDATE for every authenticated user.
--
-- A cleaner long-term fix would be to inline the recompute logic into
-- the trigger body itself (no separate function call). That deferred to
-- a follow-up — the urgent fix is restoring the publish flow today.

grant execute on function public.recompute_agent_stats(uuid)
  to anon, authenticated;

grant execute on function public.recompute_org_current_subscription(uuid)
  to anon, authenticated;

-- Sanity comment on the functions so a future advisor sweep doesn't
-- revoke these again without reading this migration.
comment on function public.recompute_agent_stats(uuid) is
  'SECURITY DEFINER; callable by anon/authenticated because trigger_recompute_agent_stats invokes it from a BEFORE/AFTER UPDATE trigger on properties. Revoking EXECUTE breaks every property UPDATE for non-service-role users. See migration 0058 for context.';
comment on function public.recompute_org_current_subscription(uuid) is
  'SECURITY DEFINER; callable by anon/authenticated because refresh_org_current_subscription_trigger invokes it from a trigger on subscriptions. See migration 0058 for context.';
