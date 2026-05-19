-- 0066_ai_conversations.sql
--
-- AI Customer-Service Agent — Phase 1 foundation schema.
-- See docs/AI_AGENT_PLAN.md for the full design (PO-accepted
-- 2026-05-18 with all defaults).
--
-- Two tables:
--   ai_conversations         — per-(lead, listing, agent) thread header;
--                              one row per conversation across the 4
--                              channels (chat / email / WhatsApp / voice).
--                              A WhatsApp message and a chat message
--                              from the same buyer about the same
--                              listing land in the same row so the AI
--                              has shared context across channels.
--   ai_conversation_messages — one row per turn (user, assistant,
--                              system, tool). Carries the confidence +
--                              intent + risk-flag classification used
--                              by the HITL gating policy.
--
-- RLS model: agents see only their own org's threads + messages.
-- Service-role bypasses both (the channel adapters + Claude
-- orchestrator run as service-role from Workers / Edge routes).
-- Anon / authenticated get NO direct write privileges — every insert
-- goes through the API layer, which sets the org_id from the
-- authenticated routing key (CLAUDE.md hard rule #4: the frontend
-- never decides what a user can do).

-- ─── ai_conversations ──────────────────────────────────────────────

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- Human owner of the conversation. Nullable for org-level chat
  -- (e.g., when an agency seat answers as the brand, not a single
  -- agent). For v1 every conversation has a single agent_id.
  agent_id uuid references public.profiles(id),
  -- Optional listing the conversation is anchored to. Set when the
  -- buyer entered from a listing page, the listing is encoded in a
  -- wa.me URL, etc. NULL for general inquiries.
  property_id uuid references public.properties(id) on delete set null,
  -- Set when the buyer leaves contact info (web chat) or always
  -- (email / WhatsApp / voice all carry buyer identity). Lead row
  -- is created via the existing /api/leads write path so routing
  -- rules + agent-notification email still fire.
  lead_id uuid references public.leads(id) on delete set null,
  channel text not null check (channel in ('web_chat', 'email', 'whatsapp', 'voice')),
  -- open | escalated | resolved | abandoned. Conversations auto-
  -- transition to abandoned after 30d of no activity (cron job; v2).
  status text not null default 'open' check (status in ('open', 'escalated', 'resolved', 'abandoned')),
  -- BCP-47; defaults EN. Adapter sets this from the buyer's
  -- inbound (browser locale for chat; Accept-Language for email;
  -- caller country for voice; WhatsApp profile language).
  buyer_locale text not null default 'en',
  -- Anonymous fingerprint for web-chat sessions before the buyer
  -- leaves contact info. Backed by a signed cookie set client-side.
  -- Nullable for non-chat channels (which always have identity).
  buyer_session_token text,
  -- Captured progressively: phone first (WhatsApp / voice channels
  -- give us E.164 immediately); email captured from chat opt-in or
  -- email channel directly.
  buyer_phone text,
  buyer_email text,
  first_message_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hot-path indexes: org filter (every read goes through RLS that
-- filters by org_id; PG plans these as index scans rather than
-- seq-scan + filter); lead lookup (linking a new turn into an
-- existing conversation); recency sort for the dashboard inbox.
create index idx_ai_conv_org on public.ai_conversations(org_id);
create index idx_ai_conv_lead on public.ai_conversations(lead_id) where lead_id is not null;
create index idx_ai_conv_agent on public.ai_conversations(agent_id) where agent_id is not null;
create index idx_ai_conv_property on public.ai_conversations(property_id) where property_id is not null;
create index idx_ai_conv_last on public.ai_conversations(last_message_at desc);
-- Web-chat session lookup. Partial index avoids bloat from the
-- millions of rows that never need a session lookup (any non-chat
-- channel always has buyer_phone or buyer_email instead).
create index idx_ai_conv_session on public.ai_conversations(buyer_session_token)
  where buyer_session_token is not null;

-- ─── ai_conversation_messages ──────────────────────────────────────

create table public.ai_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  -- Denormalized from the parent for query speed — dashboard
  -- queries filter by channel and join is expensive on 1M+ rows.
  channel text not null check (channel in ('web_chat', 'email', 'whatsapp', 'voice')),
  body text not null,
  -- Channel-specific blob. Examples:
  --   email     → { messageId, inReplyTo, attachments: [{ r2Key, name, contentType, size }] }
  --   whatsapp  → { mediaIds: [...], templateName, isInServiceWindow }
  --   voice     → { recordingR2Key, durationSec, sttConfidence, ttsVoiceId }
  --   web_chat  → null
  attachments jsonb,
  -- Set when the assistant invokes a tool (lookup_listing,
  -- find_comparable, book_viewing, escalate_to_human, etc).
  -- See src/lib/ai/converse.ts for the schema definition.
  tool_call jsonb,
  -- Set on tool-role rows; the structured output the tool returned.
  tool_result jsonb,
  -- Cross-reference into the existing AI cost-tracking table.
  -- Always populated for assistant + tool rows; null for user rows
  -- (no inference happened) and system rows (system prompts are
  -- counted as input tokens of the assistant turn that follows).
  ai_generation_log_id uuid references public.ai_generation_log(id),
  -- HITL gating fields, populated by src/lib/ai/gating.ts on the
  -- assistant's draft BEFORE the channel adapter sends it.
  confidence numeric(3,2),                       -- 0.00-1.00; classifier output
  intent text,                                   -- viewing-request | price-question | availability | discrimination-risk | legal-risk | financial-risk | escalate | other
  risk_flags text[] not null default '{}',       -- discrimination | legal | financial | commission | price_negotiation | none
  -- HITL workflow state.
  --   null         — not an assistant draft (user / system / tool rows)
  --   pending      — awaiting human approval
  --   approved     — agent reviewed + sent
  --   rejected     — agent rejected; AI will redraft
  --   auto_sent    — sent by gating policy without human review
  approval_status text check (approval_status in ('pending', 'approved', 'rejected', 'auto_sent')),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  -- When the message was actually sent to the buyer (after approval
  -- or auto-send). Null for inbound (user) rows and for pending
  -- drafts. Distinct from created_at because a draft can sit pending
  -- for hours.
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- Hot-path indexes: conversation timeline (single thread sorted),
-- approval queue (dashboard inbox shows pending across all
-- conversations), generation-log foreign-key joins.
create index idx_ai_msg_conv on public.ai_conversation_messages(conversation_id, created_at);
create index idx_ai_msg_approval on public.ai_conversation_messages(approval_status, created_at desc)
  where approval_status = 'pending';
create index idx_ai_msg_gen_log on public.ai_conversation_messages(ai_generation_log_id)
  where ai_generation_log_id is not null;

-- ─── RLS ───────────────────────────────────────────────────────────

alter table public.ai_conversations enable row level security;
alter table public.ai_conversation_messages enable row level security;

-- Agents can read their own org's conversations. Service-role
-- bypasses RLS (channel adapters write conversations as service-
-- role; the API layer scopes by routing key). No insert / update /
-- delete policies for end users — every mutation goes through the
-- API.
create policy "org_members_read_conv" on public.ai_conversations
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = ai_conversations.org_id
        and om.user_id = auth.uid()
    )
  );

create policy "org_members_read_msg" on public.ai_conversation_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.ai_conversations c
      join public.organization_members om on om.org_id = c.org_id
      where c.id = ai_conversation_messages.conversation_id
        and om.user_id = auth.uid()
    )
  );

-- Defense-in-depth: explicitly REVOKE write grants from anon +
-- authenticated. RLS-with-no-policy already blocks writes in
-- practice, but Supabase's default GRANT pattern gives broad
-- access; the migration template doc (per CLAUDE.md gotcha entry
-- after migration 0065) requires this on every new table.
revoke insert, update, delete on public.ai_conversations from anon, authenticated;
revoke insert, update, delete on public.ai_conversation_messages from anon, authenticated;

-- ─── updated_at trigger ────────────────────────────────────────────

-- Reuse the existing public.touch_updated_at() helper installed in
-- migration 0001. Conversation rows get touched every time a new
-- message lands (the API layer also updates last_message_at).
create trigger ai_conversations_set_updated_at
  before update on public.ai_conversations
  for each row execute function public.touch_updated_at();

comment on table public.ai_conversations is
  'AI customer-service agent thread header. One row per (buyer, listing?, agent) pair. Shared across the 4 channels (web_chat / email / whatsapp / voice) so the AI has cross-channel context.';

comment on table public.ai_conversation_messages is
  'AI customer-service agent turn-level rows. Carries the HITL gating fields (confidence, intent, risk_flags, approval_status) used by src/lib/ai/gating.ts to decide auto-send vs human-review.';
