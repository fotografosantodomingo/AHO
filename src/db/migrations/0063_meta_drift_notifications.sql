-- 0063_meta_drift_notifications.sql
--
-- Track who we've already emailed about a newly-linked Instagram
-- Business account, so the daily drift cron in
-- `workers/instagram-drift/` doesn't send the same prompt every day.
--
-- Phase 3 of `docs/INSTAGRAM_SHARING_PLAN.md`. The cron iterates
-- agents with Meta tokens, fetches /me/accounts, detects FB Pages
-- that newly have `instagram_business_account` linked but don't yet
-- have an `ig:{id}` row in `ad_platform_tokens` (= agent linked IG
-- in Meta Business Suite AFTER their last OAuth grant; we haven't
-- written the IG token yet because the OAuth callback hasn't run
-- since the link). One email per (user_id, ig_id) per 30 days.
--
-- Access model: no end-user access. Server-side admin client writes.
-- RLS enabled, no policies = deny-all to anon + authenticated;
-- service-role bypasses.

create table public.meta_drift_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Instagram Business id (the one Meta returns under
  -- `instagram_business_account.id` for a Page). Unique per user;
  -- the same agent can have multiple IG accounts linked to multiple
  -- Pages, each gets its own notification record.
  ig_id text not null,
  -- Optional: IG handle / display name we surfaced in the email.
  -- NULL if Meta didn't return one.
  ig_username text,
  notified_at timestamptz not null default now(),
  unique (user_id, ig_id)
);

comment on table public.meta_drift_notifications is
  'Idempotency log for the daily Instagram drift cron. One row per (agent, IG account) the cron has emailed about. Per docs/INSTAGRAM_SHARING_PLAN.md Phase 3.';

create index meta_drift_notifications_user_id_idx
  on public.meta_drift_notifications (user_id);
create index meta_drift_notifications_notified_at_idx
  on public.meta_drift_notifications (notified_at desc);

alter table public.meta_drift_notifications enable row level security;

-- No policies = deny-all to anon + authenticated; service-role bypasses.
