-- 0070_voice_integration.sql
--
-- AI Customer-Service Agent — Phase 5 voice channel schema.
-- See docs/AI_AGENT_PLAN.md §4d for the full design (PO-accepted
-- 2026-05-18 with all defaults).
--
-- Two tables:
--   agent_phone_numbers — one row per (agent, Twilio number). Carries
--                         the warm-transfer mobile, the monthly minute
--                         budget (soft cap; overage requires explicit
--                         confirmation per CLAUDE.md hard rule #9), and
--                         the voicemail-fallback recording URL. Twilio
--                         account + number purchase are PO-side actions;
--                         this row is inserted once the number is wired
--                         to the ConversationRelay TwiML.
--   voice_calls         — one row per inbound (or outbound) call. Links
--                         the Twilio call_sid back to the
--                         ai_conversations thread + ai_conversation_messages
--                         turn rows that the voice Worker writes during
--                         the call. Recording is opt-out (consent boolean
--                         defaults true with the spoken banner); the R2
--                         key is set after the Twilio recording-callback
--                         lands. v2: r2 upload is deferred — the column
--                         is here so we don't need another migration.
--
-- RLS model: agents see only their own org's phone numbers + calls.
-- voice_calls joins through the parent ai_conversations row for the
-- org_id check (mirroring ai_conversation_messages in 0066). The
-- channel adapters + voice Worker run as service-role and bypass RLS.
-- Anon / authenticated have NO direct write privileges.
--
-- CLAUDE.md gotcha (post-migration 0065): every newly-created table
-- needs explicit `revoke` of insert / update / delete from anon and
-- authenticated. RLS-with-no-write-policy already blocks writes in
-- practice but defense-in-depth is the documented pattern.

-- ─── agent_phone_numbers ────────────────────────────────────────────

create table public.agent_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  -- Human owner of the number. ON DELETE CASCADE: when an agent
  -- offboards we tear down their phone presence with them. The
  -- corresponding Twilio number release is handled by an admin
  -- runbook (not auto-released by this cascade, to avoid losing
  -- audit trails on the Twilio side).
  agent_id uuid not null references public.profiles(id) on delete cascade,
  -- Org scope for RLS. ON DELETE RESTRICT to force explicit
  -- offboarding sequencing.
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- E.164 — the Twilio-provisioned PSTN number the buyer dials.
  -- Stored as +14155551212 (no spaces, no parens). The unique index
  -- below enforces one-agent-per-number; per-agent multi-number
  -- support is v2.
  phone_e164 text not null,
  -- Twilio's PNxxx identifier (read from the Twilio API on
  -- provisioning). Needed for number-release + cost-report joins.
  twilio_sid text not null,
  -- Soft cap: per-month inclusive-minute allowance bundled into the
  -- agent's tier (60 min default per AI_AGENT_PLAN §4d retail model).
  -- Overage above this requires explicit agent confirmation; the
  -- bill-shock guardrail is enforced at the Worker layer, not in SQL.
  monthly_minute_budget integer not null default 60,
  -- Agent's personal mobile for warm-transfer. When AI can't help,
  -- Twilio dials this number with a whisper-prompt summarizing the
  -- lead. Nullable: agents without a mobile fall back to voicemail.
  forward_to_phone text,
  -- After-hours voicemail audio URL (R2 object key or signed URL).
  -- v1 stub: when the AI determines the agent is offline + buyer
  -- declined to wait, the call routes here. Optional — voicemail
  -- fallback is v2 polish.
  voicemail_recording_url text,
  -- Lifecycle. pending → active → suspended.
  --   pending    — row created but Twilio number not yet bought /
  --                ConversationRelay TwiML not yet wired
  --   active     — calls can route to this number
  --   suspended  — agent over budget or org over tier limits;
  --                inbound calls go straight to voicemail
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  created_at timestamptz not null default now()
);

-- One agent per number (no number sharing). Twilio-side enforcement
-- of "one number, one TwiML URL" matches this. Phone lookup is the
-- hot path: every inbound call hits this index once per call.
create unique index idx_agent_phone_e164 on public.agent_phone_numbers(phone_e164);
-- Agent listing in the dashboard inbox.
create index idx_agent_phone_agent on public.agent_phone_numbers(agent_id);
-- Org-wide RLS filter (rare query path; admin dashboard listing).
create index idx_agent_phone_org on public.agent_phone_numbers(org_id);

-- ─── voice_calls ─────────────────────────────────────────────────────

create table public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  -- The shared conversation header. ON DELETE CASCADE so call rows
  -- die with the parent conversation (the conversation itself is
  -- never deleted in normal operation; this is for tests + GDPR
  -- right-to-erasure flows).
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  -- The AHO number that was dialed (for inbound) or that we dialed
  -- from (for outbound; outbound is v2 polish — answer-bots only at
  -- v1 per AI_AGENT_PLAN §6 non-goals).
  agent_phone_id uuid not null references public.agent_phone_numbers(id),
  -- Twilio's CAxxx call identifier. UNIQUE so the recording-callback
  -- + status-callback webhooks idempotently find the row.
  twilio_call_sid text not null unique,
  direction text not null check (direction in ('inbound', 'outbound')),
  -- Caller-ID (E.164 when Twilio can resolve it; raw when caller
  -- withholds). Used to backfill ai_conversations.buyer_phone when
  -- this is the buyer's first contact across any channel.
  from_phone text not null,
  -- Wall-clock duration of the AI-handled segment. Populated by the
  -- Twilio status-callback when the call ends. Nullable until then.
  duration_seconds integer,
  -- R2 object key for the recording (when consent=true). Set by the
  -- recording-callback. v2 — column reserved here so we don't need a
  -- follow-up migration.
  recording_r2_key text,
  -- Defaults true; flipped false when the buyer says "no" or "stop
  -- recording" within the consent-banner window. The Worker re-asks
  -- if STT classifier flags a no-record intent during the call.
  recording_consent boolean not null default true,
  -- Warm-transfer telemetry. attempted=true when the AI invoked the
  -- escalate-to-human path; succeeded=true when the agent picked up
  -- within the 20s pickup window. Tracked separately so we can
  -- compute pickup-rate per agent (a churn signal for the dashboard).
  warm_transfer_attempted boolean not null default false,
  warm_transfer_succeeded boolean not null default false,
  -- Aggregate per-call cost (Twilio talk + Claude + STT + TTS), in
  -- US cents. Computed by lib/voice/pricing.ts at call end.
  -- Defaults zero so partial-data rows still have a sortable column.
  cost_cents integer not null default 0,
  created_at timestamptz not null default now()
);

-- Conversation-timeline lookup (dashboard inbox: show me the calls
-- in this thread).
create index idx_voice_call_conv on public.voice_calls(conversation_id, created_at);
-- Already covered by the unique constraint, but a named index lets
-- explain plans pick it up by name for joins from the status-callback
-- handler.
create index idx_voice_call_sid on public.voice_calls(twilio_call_sid);

-- ─── RLS ────────────────────────────────────────────────────────────

alter table public.agent_phone_numbers enable row level security;
alter table public.voice_calls enable row level security;

-- Agents can read their own org's phone numbers. Service-role
-- bypasses RLS for Worker-side writes during the call. No insert /
-- update / delete policies for end users — provisioning happens via
-- admin runbooks + API, never client-direct.
create policy "org_members_read_phone" on public.agent_phone_numbers
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = agent_phone_numbers.org_id
        and om.user_id = auth.uid()
    )
  );

-- voice_calls scope check joins through the parent conversation row
-- (which carries the canonical org_id). Mirrors the
-- ai_conversation_messages pattern in migration 0066.
create policy "org_members_read_voice_call" on public.voice_calls
  for select to authenticated
  using (
    exists (
      select 1
      from public.ai_conversations c
      join public.organization_members om on om.org_id = c.org_id
      where c.id = voice_calls.conversation_id
        and om.user_id = auth.uid()
    )
  );

-- Defense-in-depth: explicitly REVOKE write grants from anon +
-- authenticated. RLS-with-no-policy already blocks writes; this
-- matches the CLAUDE.md gotcha pattern (precedent: migration 0065).
revoke insert, update, delete on public.agent_phone_numbers from anon, authenticated;
revoke insert, update, delete on public.voice_calls from anon, authenticated;

comment on table public.agent_phone_numbers is
  'Per-agent Twilio phone number for the AI voice channel. One row per (agent, E.164 number). Carries the monthly minute budget, warm-transfer mobile, and voicemail-fallback URL.';

comment on table public.voice_calls is
  'Per-call telemetry for the AI voice channel. Linked to the shared ai_conversations thread via conversation_id so chat / email / WhatsApp / voice all aggregate into one buyer history.';
