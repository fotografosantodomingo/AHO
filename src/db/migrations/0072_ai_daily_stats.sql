-- 0072_ai_daily_stats.sql
--
-- Pre-aggregated daily rollup of AI conversation events for fast
-- dashboard reads. Populated by `workers/ai-daily-rollup/` at 02:00
-- UTC each day from the previous day's `ai_conversation_events` rows.
-- The dashboard analytics AI tab + the admin /admin/ai-overview view
-- both read from THIS table, never the raw events.
--
-- Keyed by (org_id, agent_id, day):
--   - one row per agent per org per day
--   - org-level totals come from `select sum(...) where agent_id is null`
--     OR from summing all agent rows for the org on that day
--     (rollup writes BOTH — a per-agent row AND an `agent_id IS NULL`
--     row per org per day to make org-level queries one indexed scan
--     instead of a sum-with-distinct)
--
-- UPSERT pattern on (org_id, agent_id, day) makes the rollup
-- idempotent — if the cron runs twice for the same day, the row is
-- overwritten, never duplicated.

create table public.ai_daily_stats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- NULL row per (org_id, day) holds the org-level totals;
  -- agent_id NOT NULL rows hold per-agent totals.
  agent_id uuid references public.profiles(id) on delete set null,
  day date not null,
  -- Counts —
  conversations integer not null default 0,
  user_messages integer not null default 0,
  drafts_pending integer not null default 0,
  drafts_approved integer not null default 0,
  drafts_edited integer not null default 0,
  drafts_auto_sent integer not null default 0,
  drafts_rejected integer not null default 0,
  escalations integer not null default 0,
  leads_captured integer not null default 0,
  viewings_booked integer not null default 0,
  -- Cost — sum of `ai_generation_log.estimated_cost_usd_cents` for
  -- the day's calls attributed to this org. NULL when there were no
  -- AI calls on this day for this org.
  cost_usd_cents bigint,
  -- Mix jsonb columns — count by category, e.g.
  --   intent_counts = { "viewing-request": 4, "price-question": 2 }
  --   risk_flag_counts = { "none": 8, "financial": 1 }
  --   channel_counts = { "web_chat": 9, "email": 0 }
  -- Empty jsonb '{}' default keeps queries simple (no NULL guards).
  intent_counts jsonb not null default '{}'::jsonb,
  risk_flag_counts jsonb not null default '{}'::jsonb,
  channel_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (org, agent, day). The `agent_id is null` rows hold
-- the org-level rollup; per-agent rows hold their own.
create unique index uq_ai_daily_stats_org_agent_day
  on public.ai_daily_stats(org_id, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), day);

create index idx_ai_daily_stats_org_day on public.ai_daily_stats(org_id, day);
create index idx_ai_daily_stats_day on public.ai_daily_stats(day desc);

alter table public.ai_daily_stats enable row level security;

create policy "org_members_read_ai_daily" on public.ai_daily_stats
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = ai_daily_stats.org_id
        and om.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.ai_daily_stats from anon, authenticated;

create trigger ai_daily_stats_set_updated_at
  before update on public.ai_daily_stats
  for each row execute function public.touch_updated_at();

comment on table public.ai_daily_stats is
  'Daily rollup of ai_conversation_events keyed by (org_id, agent_id, day). agent_id IS NULL rows hold org-level totals; agent_id NOT NULL rows hold per-agent. UPSERT pattern in the rollup cron makes re-runs idempotent.';
