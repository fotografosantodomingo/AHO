-- 0033_saved_searches_last_notified_at.sql
--
-- Add `last_notified_at` to `saved_searches` so the email-alert worker
-- (separate CF Worker `aho-saved-search-worker`, scheduled via Cron
-- Trigger) can track the last server-side digest dispatch independently
-- from the user-facing `last_seen_at` (= when the user opened the saved-
-- searches dashboard).
--
-- These two timestamps deliberately diverge:
--   - `last_seen_at`  is bumped client-side / by route loaders; the user
--                     might open the dashboard daily but only want a
--                     weekly digest.
--   - `last_notified_at` is bumped server-side by the worker after a
--                     successful Brevo dispatch; gates idempotent retry
--                     within the same cron window.
--
-- Worker workflow:
--   1. SELECT saved_searches WHERE notify_email = true
--                AND (last_notified_at IS NULL OR last_notified_at < now() - interval '20 hours')
--   2. For each row: re-run the filter against properties published since
--      coalesce(last_notified_at, created_at).
--   3. If matches > 0: send Brevo digest, then UPDATE last_notified_at = now().
--
-- Additive migration; existing rows get NULL which the worker treats as
-- "first run — use saved_searches.created_at as the floor".

alter table public.saved_searches
  add column if not exists last_notified_at timestamptz;

-- Index on (notify_email, last_notified_at) so the worker's WHERE clause
-- doesn't full-scan saved_searches as the table grows. Partial index on
-- the opt-in subset since the worker never queries the others.
create index if not exists idx_saved_searches_notify_due
  on public.saved_searches (last_notified_at nulls first)
  where notify_email = true;
