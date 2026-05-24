-- 0079_revoke_service_role_only_tables.sql
--
-- Hardening sweep — extend the `revoke all on … from anon, authenticated`
-- pattern (precedent: migration 0065_revoke_extra_grants.sql) to every
-- pre-0065 service-role-only table that was missed when 0065 shipped.
--
-- A "service-role-only table" here means: RLS is enabled AND there are
-- zero `create policy` rows AND every read/write goes through service-
-- role (admin client / SECURITY DEFINER RPC). RLS with no policy already
-- blocks anon + authenticated in practice, but Supabase's default
-- `grant select on table to anon, authenticated` from table creation
-- leaves a soft surface that an accidentally-added policy could turn
-- into an exposure. Belt-and-suspenders.
--
-- Tables covered by this migration:
--   • stripe_events_processed (0003) — webhook dedup; service-role writes
--     from the Stripe webhook handler; never user-facing.
--   • founder_rate_counter   (0008) — atomic-claim row; only the
--     claim_founder_rate_slot() SECURITY DEFINER RPC touches it.
--   • auth_login_challenges  (0047) — OTP challenges; only the
--     /api/auth/* routes write/read via the admin client.
--   • tawk_events_processed  (0054) — webhook dedup mirror of
--     stripe_events_processed; same posture.
--
-- Audit: 2026-05-24 sweep. No other pre-0065 RLS-enabled table is fully
-- service-role-only (all others have at least one SELECT or admin-all
-- policy and remain reachable through that policy by design).

revoke all on public.stripe_events_processed from anon, authenticated;
revoke all on public.founder_rate_counter from anon, authenticated;
revoke all on public.auth_login_challenges from anon, authenticated;
revoke all on public.tawk_events_processed from anon, authenticated;
