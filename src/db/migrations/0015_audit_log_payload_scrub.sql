-- 0015_audit_log_payload_scrub.sql
-- Retroactive privacy scrub. Phase 1A's mark-sold/mark-rented and
-- archive endpoints originally wrote `closing_notes` and `prior_status`
-- into `audit_log.payload`. Migration 0014 then opened anon-read on
-- listing.marked_sold + listing.marked_rented payloads — meaning any
-- audit row written between 0013 (Phase 1A deploy) and the payload-
-- scrub patch had those private fields exposed.
--
-- The fix in lib/audit/audit-payload.ts ensures new rows never include
-- those keys. This migration scrubs the keys from any historical rows
-- so the existing audit_log set matches the new contract. Idempotent:
-- the `-` operator on jsonb is a no-op when the key isn't present.

update public.audit_log
set payload = payload - 'closing_notes' - 'prior_status'
where kind in (
  'listing.marked_sold',
  'listing.marked_rented',
  'listing.archived',
  'listing.unarchived'
);
