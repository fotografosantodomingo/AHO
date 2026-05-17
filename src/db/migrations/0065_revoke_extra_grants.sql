-- 0065_revoke_extra_grants.sql
--
-- Hardening pass — REVOKE SELECT from anon + authenticated on the
-- three service-role-only tables shipped today. Migrations
-- 0061/0062/0063 enabled RLS with NO policies (= deny-all to
-- non-service-role roles in practice), but Supabase's default
-- table-creation grants gave anon + authenticated SELECT anyway.
-- RLS still blocks reads (no policy = no row visible), so this
-- isn't a live exposure — but it's defense-in-depth missing and
-- diverges from the migration files' stated intent ("no end-user
-- access; service-role bypasses").
--
-- QA finding 2026-05-17. After this migration, the three tables
-- have RLS-on + no policies + no role grants → triple-locked.
-- Going forward the migration template will include an explicit
-- REVOKE alongside the ENABLE ROW LEVEL SECURITY line.

revoke all on public.ai_generation_log from anon, authenticated;
revoke all on public.audit_funnel_events from anon, authenticated;
revoke all on public.meta_drift_notifications from anon, authenticated;
