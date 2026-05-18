# AI Conversion Stack — the next big plan

> **Why this exists:** the AI agent shipped today (2026-05-18, commits `c1f5b10` → `08d5e3e`). It's now answering buyers across web chat on `/properties/[slug]` + `/agents/[slug]`, with email / WhatsApp / voice scaffolded and waiting on PO creds. **But we have no visibility into whether the AI is actually converting.** An agent who can't see "AI handled 12 conversations this week → 3 became leads → 1 became a viewing" has no reason to trust the inbox; the PO has no metric to defend the Pro Automation price; the fundraise pitch has no conversion number to put on slide 3.
>
> This plan builds the **AI Conversion Stack** — the analytics + dashboards + notifications that turn AI chats from a black box into measurable agent ROI.
>
> **Status:** DRAFT 2026-05-18 by Claude after shipping the AI agent. Authored mid-session under the PO directive "continue with a big plan." Executing Phase 1 immediately (no further PO sign-off needed; this is the natural extension of the already-accepted AI_AGENT_PLAN).

---

## 1. The wedge — what this unlocks

Three audiences, three benefits:

| Audience | Today | After this plan |
|---|---|---|
| **Agent on Pro Automation** | Sees a dashboard inbox with "12 pending drafts." Has no sense of whether those drafts are valuable. | Sees "AI handled 12 conversations this week, generated 3 qualified leads, saved ~6 hrs vs manual reply." Decides the $99/mo is paying for itself. |
| **PO running the platform** | Has cost data (`/admin/audit-costs`) but no conversion data. Can't decide whether to flip D2 to auto-send (need confidence rate, edit rate, approval rate). | Sees per-org + cross-org rollups: intent mix, escalation rate, approval rate, edit rate, conversation→lead rate, agent-tier adoption curve. Makes data-driven decisions about D2, Super Pro pricing, expansion markets. |
| **Investor reading the pitch** | Sees `docs/PITCH_OUTLINE.md` defending "AHO IS the platform" thesis. Gets one anecdote ("we built it in a day"). | Gets a real metric: "AI handles N% of agent-side conversations, recovering X hours/agent/month, converting Y% of buyer chats to qualified leads." That's the slide 3 number that turns a maybe into a meeting. |

---

## 2. The four phases

Each independently shippable; Phase 1 is the load-bearing schema everything else depends on.

### Phase 1 — Foundation: event stream + daily rollup (~1 day)

**Goal:** every meaningful moment in an AI conversation lands as a row in `ai_conversation_events`. A nightly cron rolls it up into `ai_daily_stats` for fast dashboard reads.

**Deliverables:**
- Migration `0071_ai_conversation_events.sql` — funnel-event table (started, message_user, draft_pending, approved, edited, auto_sent, rejected, escalated, lead_captured, viewing_booked, abandoned).
- Migration `0072_ai_daily_stats.sql` — pre-aggregated rollup keyed by (org_id, agent_id, day). Indexes for week / month range queries.
- Migration `0073_ai_conversation_tier_snapshot.sql` — adds `tier_at_creation` column to `ai_conversations` so adoption curves by tier survive a tier change.
- `src/lib/ai/conversation-events.ts` — `recordEvent({ kind, conversationId, ... })` helper. Awaited inserts; destructured errors; no fake data.
- Wire `recordEvent` into the 5 existing AI surfaces:
  - `/api/ai-chat` (chat first turn → `started`; user turn → `message_user`; assistant turn → `draft_pending`)
  - `/api/dashboard/ai-inbox/approve` → `approved` (+ `edited` if `editedBody` set; + `auto_sent` if it skipped pending)
  - `/api/dashboard/ai-inbox/reject` → `rejected`
  - `src/lib/ai/converse.ts:toolEscalateToHuman` → `escalated`
  - `src/lib/ai/converse.ts:toolBookViewing` → `viewing_booked`
  - `/api/ai-chat`'s lead-capture path (when a user leaves contact info) → `lead_captured`
- Cron worker `workers/ai-daily-rollup/` — fires 02:00 UTC daily; aggregates yesterday's events into `ai_daily_stats`.
- Pages-side endpoint `/api/cron/ai-daily-rollup` mirroring the existing cron pattern; the worker pings this endpoint.

### Phase 2 — Agent-side dashboard tab (~1 day)

**Goal:** every Pro Automation+ agent sees their AI ROI when they open `/dashboard/analytics`.

**Deliverables:**
- New "AI" tab in `/dashboard/analytics` (already exists for property/lead/social metrics; this is a 4th tab).
- Top-line tiles:
  - **Conversations this week** (+/- vs last week)
  - **Approval rate** (approved / (approved + edited + rejected))
  - **Edit rate** (% of approvals that required editing)
  - **Lead capture rate** (lead_captured / conversations)
  - **Time saved** (estimate: 8 min per AI-handled conversation × conversations)
- **Intent mix** donut chart (viewing-request, price-question, availability, etc).
- **Risk flag frequency** stacked bar (discrimination, legal, financial, commission, price_negotiation, none).
- **Top-performing listings** table — listings ranked by conversation count + lead capture rate.
- **Trend chart** — conversations + leads, daily, last 30 days.
- Empty state when no AI activity yet (soft-beta phase): "No AI conversations yet. Once you publish a listing or get a buyer inquiry, this tab will populate."

### Phase 3 — Admin / PO cross-org view (~0.5 day)

**Goal:** PO can answer "how is the AI doing across all Pro Automation agents?" in 30 seconds.

**Deliverables:**
- New `/admin/ai-overview` page (mirrors `/admin/audit-costs` layout pattern).
- Top-line tiles (cross-org):
  - **Total AI conversations** (7d / 30d / lifetime)
  - **Active AI agents** (orgs with ≥1 conversation in last 7d)
  - **Cross-org approval rate**
  - **Avg conversation-to-lead conversion**
  - **Total leads attributed to AI** (lifetime)
- **Daily activity** chart (last 30 days)
- **Per-tier adoption** — how Pro Automation agents are using AI vs would-be Super Pro
- **Per-market split** — where conversations are happening (US/ES/PL/PT/DE/FR/IT)
- **Top 10 active agents** table — to identify power users + recruit testimonials
- **Cost-effectiveness** — AI cost per lead (joins `ai_generation_log` + lead_captured events)
- Service-role read pattern (mirrors `/admin/audit-costs`).

### Phase 4 — Notifications + agent retention (~0.5 day)

**Goal:** agents stay engaged with the AI inbox without checking it manually. Drafts get reviewed within hours, not days.

**Deliverables:**
- **Inline approval-queue badge** on the dashboard sidebar — `<NavAiInboxBadge>` shows pending count next to "AI inbox" in the nav. Server-rendered (RSC); refreshes on each dashboard route.
- **Weekly email digest** every Monday 09:00 in agent's market timezone: subject line "{N} new AI conversations this week — review your inbox." Body: top 3 conversations, approval status, link to dashboard.
  - New cron worker `workers/ai-weekly-digest/` + Pages-side `/api/cron/ai-weekly-digest`
  - Brevo template `email/templates/ai-weekly-digest.ts`
- **In-product nudge** in the dashboard when there are 3+ pending drafts older than 24h: amber banner "Your buyers are waiting — you have N drafts that need your attention."

---

## 3. Schema design (Phase 1 detail)

### `ai_conversation_events`

```sql
create table public.ai_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  -- Denormalized for hot-path rollup queries (avoid join on the rollup
  -- cron at 02:00 UTC).
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.profiles(id) on delete set null,
  channel text not null check (channel in ('web_chat', 'email', 'whatsapp', 'voice')),
  -- The funnel-event kinds. Add new kinds via migration; the rollup
  -- script reads from a constants file so it stays in sync.
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
  -- Per-event metadata; structure varies by kind. Examples:
  --   approved → { messageId, approvedBy, msSincePending }
  --   lead_captured → { leadId, contactType: 'email'|'phone' }
  --   viewing_booked → { listingId, leadId, requestedTime }
  payload jsonb,
  created_at timestamptz not null default now()
);

create index idx_aiev_org_day on public.ai_conversation_events(org_id, created_at);
create index idx_aiev_agent on public.ai_conversation_events(agent_id) where agent_id is not null;
create index idx_aiev_conv on public.ai_conversation_events(conversation_id);
create index idx_aiev_kind on public.ai_conversation_events(kind, created_at);

alter table public.ai_conversation_events enable row level security;
create policy "org_members_read_aiev" on public.ai_conversation_events
  for select to authenticated
  using (exists (select 1 from public.organization_members om
                 where om.org_id = ai_conversation_events.org_id
                   and om.user_id = auth.uid()));
revoke insert, update, delete on public.ai_conversation_events from anon, authenticated;
```

### `ai_daily_stats`

```sql
create table public.ai_daily_stats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid references public.profiles(id) on delete set null,
  day date not null,
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
  -- Joined from ai_generation_log; estimated cost for the day's
  -- AI calls attributed to this org. NULL when there were no calls.
  cost_usd_cents bigint,
  -- Intent mix as jsonb { viewing_request: 4, price_question: 2, ... }
  intent_counts jsonb not null default '{}'::jsonb,
  risk_flag_counts jsonb not null default '{}'::jsonb,
  -- Channel mix
  channel_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index uq_ai_daily_stats_org_agent_day on public.ai_daily_stats(org_id, agent_id, day);
create index idx_ai_daily_stats_org_day on public.ai_daily_stats(org_id, day);
create index idx_ai_daily_stats_day on public.ai_daily_stats(day desc);

alter table public.ai_daily_stats enable row level security;
create policy "org_members_read_ai_daily" on public.ai_daily_stats
  for select to authenticated
  using (exists (select 1 from public.organization_members om
                 where om.org_id = ai_daily_stats.org_id
                   and om.user_id = auth.uid()));
revoke insert, update, delete on public.ai_daily_stats from anon, authenticated;
```

### `ai_conversations.tier_at_creation`

```sql
alter table public.ai_conversations
  add column tier_at_creation text default 'unknown';
```

---

## 4. Risks + trade-offs

| # | Risk | Mitigation |
|---|---|---|
| R1 | Event-volume explosion on busy agents (1000+ events/day per agent → millions per month) | Daily rollup deletes raw events older than 90 days (keeps the rollup); partition the events table by month if we hit scale (Phase 2 polish, not v1). |
| R2 | Rollup cron drift — if the worker fails one night, the dashboard shows stale data | Cron is idempotent (UPSERT on `(org_id, agent_id, day)`); manual catch-up SQL one-liner documented in the worker README. |
| R3 | Privacy — does showing the PO cross-org conversation counts violate buyer privacy? | The admin view shows AGGREGATES only (counts + rates), never message bodies. The buyer's session token is the only buyer-identifying field and it never leaves the conversation row. |
| R4 | The "time saved" metric is a guesstimate (8 min/conversation) — agents could call it out | Label it clearly as an estimate; let agents click through to see the methodology. Defer "real time saved" to user research. |
| R5 | The weekly digest could be spammy if an agent has zero AI activity | Skip the email entirely when `conversations === 0` (the agent gets nothing rather than "you had zero conversations" which feels like a guilt-trip). |
| R6 | Cost overrun on the rollup query at scale | Rollup uses indexed range queries on `created_at`; benchmarks needed at ~10k events/day before optimizing further. |
| R7 | Admin view shows test-org data (RLS fixture orgs) | Filter `organizations.slug NOT LIKE 'aho-test-org-%'` per the standard pattern (CLAUDE.md R11). |

---

## 5. What this enables (next session and beyond)

Once Phase 1-4 ship, several follow-ons become trivial:

- **D2 = B (confidence-gated auto-send)** — we'll have the data (approval-without-edit rate, by intent + risk flag) to defend flipping the policy
- **Super Pro pricing defense** — "Pro Automation agents are saving X hours/month with the AI inbox" justifies the $249/mo jump
- **Per-agent A/B testing** — could roll out new prompt variants to 10% of agents, measure conversion delta in `ai_daily_stats`
- **Conversation replay for prompt tuning** — pair the events stream with the full conversation history; review the AI's worst-performing turns
- **Agency tier supervisor dashboard** — same rollup tables, scoped by org with multi-member roles (Track 2)
- **Customer-facing "AI did X for you this week" email** — same data, repackaged as a Pro Automation retention email

---

## 6. Phasing decision

**Defaults (no PO sign-off needed; executing immediately):**
- Phase 1 (foundation) — done this session
- Phase 2 (agent dashboard) — parallel agent, this session
- Phase 3 (admin view) — parallel agent, this session
- Phase 4 (notifications + digest) — parallel agent, this session

PO can override / re-scope any phase by replying in chat. Otherwise this ships under the same "all-defaults" posture as AI_AGENT_PLAN.
