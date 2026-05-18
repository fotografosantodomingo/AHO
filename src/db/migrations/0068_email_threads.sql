-- 0068_email_threads.sql
--
-- AI Customer-Service Agent — Phase 3 (Email channel) schema.
-- See docs/AI_AGENT_PLAN.md §4b for the design (PO-accepted
-- 2026-05-18 with all defaults — D1=A through D9=A).
--
-- Two tables:
--   email_threads   — one row per RFC-5322 email thread; pinned to
--                     a single ai_conversations row. Threading
--                     happens by walking In-Reply-To / References
--                     headers; the ROOT message of the thread is
--                     pinned by its Message-ID for fast lookup.
--   email_messages  — one row per individual email (inbound or
--                     outbound) within the thread. Carries the
--                     RFC-5322 routing headers + DKIM/SPF/DMARC
--                     verification results captured at ingest by
--                     the Cloudflare Email Worker.
--
-- Cross-reference: every email_messages row points at exactly one
-- ai_conversation_messages row (1:1; the email is the channel-
-- specific representation of a turn). Going the other way,
-- ai_conversation_messages.attachments JSONB stores the slim
-- channel-specific blob; email_messages stores the full headers +
-- auth-results that we want indexable + filterable.
--
-- RLS model: mirror migration 0066 — agents see only their own
-- org's threads + messages, via the conversation foreign key.
-- Service-role bypasses (the inbound Email Worker + the AHO API
-- route + the outbound sender all run as service-role).
-- Anon / authenticated get NO direct write privileges.

-- ─── email_threads ────────────────────────────────────────────────

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  -- Parent conversation. Many email_threads can theoretically point
  -- at the same conversation (e.g., buyer starts a new email thread
  -- about the same listing — we may decide to merge them into the
  -- same conversation for shared AI memory). For v1 the router
  -- typically creates one thread per conversation.
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  -- The Message-ID of the very first email in this thread. Used as
  -- the threading anchor: when a new inbound email arrives, the
  -- Worker looks up whether its In-Reply-To header matches any
  -- known root_message_id (or any message_id within the thread via
  -- email_messages — see idx_email_msg_message_id).
  root_message_id text not null,
  -- "Re:" / "Fwd:" stripped, whitespace collapsed, lowercased.
  -- Used as a last-resort threading fallback when In-Reply-To
  -- and References headers are missing or unrecognized (some
  -- clients strip them on forward).
  subject_normalized text not null,
  created_at timestamptz not null default now()
);

-- Unique on root_message_id: a Message-ID is globally unique by
-- RFC-5322, so two threads can't share a root. Also serves as the
-- primary threading-lookup index for the inbound Worker.
create unique index idx_email_thread_root on public.email_threads(root_message_id);
-- Reverse-lookup: "show me all email threads for this conversation".
-- Used by the dashboard inbox to render the email-channel timeline.
create index idx_email_thread_conv on public.email_threads(conversation_id);

-- ─── email_messages ───────────────────────────────────────────────

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.email_threads(id) on delete cascade,
  -- 1:1 link to the channel-agnostic turn row. Every inbound email
  -- creates one ai_conversation_messages (role='user', channel=
  -- 'email') AND one email_messages row. Outbound email reply does
  -- the same with role='assistant'.
  conversation_message_id uuid not null references public.ai_conversation_messages(id) on delete cascade,
  -- This email's own Message-ID (RFC-5322 header, including the
  -- angle brackets stripped). Indexed for threading lookups.
  message_id text not null,
  -- The Message-ID this email replies to. Null on thread roots.
  in_reply_to text,
  -- Ordered References chain (oldest → newest). Used by the
  -- outbound sender to populate the References header correctly
  -- so Gmail/Outlook thread the reply.
  references_chain text[] not null default '{}',
  direction text not null check (direction in ('inbound', 'outbound')),
  from_addr text not null,
  to_addr text[] not null,
  cc_addr text[] not null default '{}',
  -- Full RFC-5322 headers as captured by postal-mime. Keeps
  -- raw form so future debugging / spam-classifier-retraining
  -- has everything it needs without re-fetching the email.
  raw_headers jsonb not null,
  -- DKIM/SPF/DMARC results extracted from the Authentication-
  -- Results header at ingest. The Worker drops DMARC=fail outright
  -- so dmarc_pass=false rows should never appear; tracked for
  -- diagnostic visibility if the rule is relaxed in v2.
  dkim_pass boolean,
  spf_pass boolean,
  dmarc_pass boolean,
  -- Optional spam score from MailChannels Inbound Shield (Pro+
  -- tier add-on per AI_AGENT_PLAN R6). Null when the Shield
  -- isn't in front of this inbox.
  spam_score numeric(4,2),
  created_at timestamptz not null default now()
);

-- Hot-path indexes:
--   message_id lookup for inbound threading (when a new email arrives
--   with In-Reply-To: <Z>, find the row whose message_id = Z).
create index idx_email_msg_message_id on public.email_messages(message_id);
--   thread timeline (the dashboard renders this).
create index idx_email_msg_thread on public.email_messages(thread_id, created_at);
--   conversation-message FK reverse lookup (rendering email-channel
--   metadata in the unified conversation timeline).
create index idx_email_msg_conv_msg on public.email_messages(conversation_message_id);

-- ─── RLS ──────────────────────────────────────────────────────────

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

-- Mirror the migration 0066 pattern: agents see only their own
-- org's email threads + messages, joined through the parent
-- ai_conversations row. Service-role bypasses both (the Email
-- Worker writes as service-role from the /api/inbound/email
-- handler; the outbound sender writes as service-role from
-- /api/ai-chat-followup once it ships).
create policy "org_members_read_email_threads" on public.email_threads
  for select to authenticated
  using (
    exists (
      select 1
      from public.ai_conversations c
      join public.organization_members om on om.org_id = c.org_id
      where c.id = email_threads.conversation_id
        and om.user_id = auth.uid()
    )
  );

create policy "org_members_read_email_messages" on public.email_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.email_threads t
      join public.ai_conversations c on c.id = t.conversation_id
      join public.organization_members om on om.org_id = c.org_id
      where t.id = email_messages.thread_id
        and om.user_id = auth.uid()
    )
  );

-- Defense-in-depth: explicitly REVOKE write grants from anon +
-- authenticated. RLS-with-no-policy already blocks writes in
-- practice, but Supabase's default GRANT pattern gives broad
-- access; the migration template (per CLAUDE.md gotcha entry
-- after migration 0065) requires this on every new table.
revoke insert, update, delete on public.email_threads from anon, authenticated;
revoke insert, update, delete on public.email_messages from anon, authenticated;

comment on table public.email_threads is
  'RFC-5322 email thread anchor for AI customer-service agent. One row per buyer-initiated email thread, pinned to a single ai_conversations row.';

comment on table public.email_messages is
  'Per-email rows within an email_threads thread. Carries the RFC-5322 routing headers + DKIM/SPF/DMARC verification captured at ingest by workers/inbound-email. 1:1 with ai_conversation_messages for email-channel turns.';
