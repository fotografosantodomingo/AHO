-- 0071_ai_conversation_events.sql
--
-- Funnel-event stream for the AI Conversion Stack (Phase 1 of
-- docs/AI_CONVERSION_PLAN.md). Every meaningful moment in an AI
-- conversation lands here:
--   started, message_user, draft_pending, approved, edited,
--   auto_sent, rejected, escalated, lead_captured, viewing_booked,
--   abandoned
--
-- The downstream daily rollup (`ai_daily_stats`, migration 0072) +
-- the dashboard analytics tab + the admin cross-org view all read
-- from aggregates derived from these rows. Raw rows are kept ~90
-- days then pruned by a future cron (out of scope for this migration).
--
-- Denormalized `org_id` + `agent_id` columns avoid a join on the
-- 02:00 UTC rollup query — the rollup hits ~hundreds of thousands
-- of rows per day at scale and we want a single-table index scan.
--
-- RLS: org_members can read their org's events; service-role writes
-- (every existing AI surface calls `recordEvent()` via
-- `src/lib/ai/conversation-events.ts` which uses the admin client).

create table public.ai_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  -- Denormalized for hot-path rollup queries; matches the parent
  -- conversation's org_id at write time (validated by recordEvent).
  org_id uuid not null references public.organizations(id) on delete cascade,
  -- Nullable because org-level conversations (agency seats) may not
  -- have a single agent attributable. v1 every conversation has an
  -- agent_id; this mirrors the parent's nullable column.
  agent_id uuid references public.profiles(id) on delete set null,
  channel text not null check (channel in ('web_chat', 'email', 'whatsapp', 'voice')),
  kind text not null check (kind in (
    'started',
    'message_user',
    'draft_pending',
    'approved',
    'edited',
    'auto_sent',
    'rejected',
    'escalated',
    'lead_captured',
    'viewing_booked',
    'abandoned'
  )),
  -- Per-event metadata. Structure varies by kind. Examples:
  --   approved → { messageId, approvedBy, msSincePending }
  --   edited   → { messageId, approvedBy, msSincePending, bodyChangedChars }
  --   lead_captured → { leadId, contactType: 'email'|'phone' }
  --   viewing_booked → { listingId, leadId, requestedTime }
  --   message_user → { messageId, intent?, confidence? }
  --   started → { surfaceContext?, buyerLocale }
  -- v1 readers tolerate missing keys (rollup uses `coalesce`).
  payload jsonb,
  created_at timestamptz not null default now()
);

-- Hot-path indexes for the rollup + the dashboard:
--   - (org_id, created_at) → "all events for org X in date range"
--   - (agent_id) partial → "events for agent X" (per-agent rollup)
--   - (conversation_id) → "full event timeline for one conversation"
--   - (kind, created_at) → cross-org admin queries by event kind
create index idx_aiev_org_day on public.ai_conversation_events(org_id, created_at);
create index idx_aiev_agent on public.ai_conversation_events(agent_id) where agent_id is not null;
create index idx_aiev_conv on public.ai_conversation_events(conversation_id);
create index idx_aiev_kind on public.ai_conversation_events(kind, created_at);

alter table public.ai_conversation_events enable row level security;

create policy "org_members_read_aiev" on public.ai_conversation_events
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = ai_conversation_events.org_id
        and om.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.ai_conversation_events from anon, authenticated;

comment on table public.ai_conversation_events is
  'Funnel-event stream for AI conversations. Every approve/edit/reject/escalate/lead_captured/viewing_booked event lands here. Feeds ai_daily_stats (migration 0072) + the dashboard analytics AI tab + the admin /admin/ai-overview cross-org view.';
