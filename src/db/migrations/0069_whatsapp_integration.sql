-- 0069_whatsapp_integration.sql
--
-- AI Customer-Service Agent — Phase 4 (WhatsApp channel) schema.
-- See docs/AI_AGENT_PLAN.md §4c for the full design (PO-accepted
-- 2026-05-18 with all defaults; D3=A 360dialog BSP, D4=A shared AHO
-- WABA with per-agent verified numbers).
--
-- Three tables:
--
--   whatsapp_numbers   — one row per agent-owned WhatsApp Business
--                        phone number. Carries the BSP routing key
--                        (360dialog account id + WABA id) plus a
--                        per-number monthly template-spend cap.
--   whatsapp_templates — pre-approved message templates we submit to
--                        Meta. Service-role-only because templates
--                        are GLOBAL per-language (the same
--                        `viewing_reminder_v1.en` row serves every
--                        agent); no per-agent customization at v1.
--   whatsapp_messages  — per-message row joined to the shared
--                        ai_conversation_messages spine. Records the
--                        Meta-side wa_message_id (needed to attach
--                        delivery callbacks), in-service-window flag
--                        (zero-cost for service-window messages,
--                        template-rate otherwise), and per-message
--                        cost in USD cents for budget enforcement.
--
-- RLS model: org_members can read their org's whatsapp_numbers +
-- whatsapp_messages (via parent ai_conversation join, mirroring the
-- migration 0066 ai_conversation_messages policy). whatsapp_templates
-- is service-role-only — templates are platform-managed and the
-- agent dashboard reads them via the API layer with explicit
-- whitelisting.
--
-- Defense-in-depth: explicit REVOKE on insert/update/delete from
-- anon + authenticated per the CLAUDE.md gotcha that surfaced after
-- migration 0065 (Supabase default GRANT pattern leaks too broad).

-- ─── whatsapp_numbers ──────────────────────────────────────────────

create table public.whatsapp_numbers (
  id uuid primary key default gen_random_uuid(),
  -- Human owner of the WhatsApp line. ON DELETE CASCADE so removing
  -- an agent profile also tears down their WhatsApp wiring (Meta
  -- side has to be cleaned up separately via the BSP API; that's a
  -- v2 housekeeping cron — for now the row just stops being read).
  agent_id uuid not null references public.profiles(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete restrict,
  -- E.164 (+14155551212). Unique across the platform — Meta enforces
  -- per-number ownership at the WABA layer.
  phone_e164 text not null,
  -- Meta WABA id. With D4=A (shared AHO WABA) this is the same value
  -- for every agent on the platform; we store it per-row anyway so a
  -- future agency-owned WABA migration is a non-event.
  waba_id text not null,
  -- "Maria Lopez — AHO". Verified per-number by Meta; appears in the
  -- buyer's WhatsApp client. Editable by the agent post-onboarding.
  display_name text not null,
  -- Meta number-cert pass timestamp. NULL until Meta's verification
  -- webhook fires. Status transitions from 'pending' → 'active' only
  -- after this is set.
  verified_at timestamptz,
  -- BSP routing. D3=A → 360dialog at launch; Twilio remains the
  -- documented fallback (R5 in docs/RISKS.md).
  bsp_provider text not null default '360dialog' check (bsp_provider in ('360dialog', 'twilio', 'meta_direct')),
  bsp_account_id text not null,
  -- Soft cap on template-message spend per calendar month. AHO
  -- absorbs service-window cost (free per Meta); templates are
  -- pass-through and we cap them to protect the agent from a
  -- runaway buyer. Default $10/mo; agent can raise in their
  -- dashboard. Enforced in src/lib/whatsapp/send.ts (Phase 4 polish).
  monthly_template_budget_cents integer not null default 1000,
  -- Count of buyers who explicitly opted in to MARKETING templates
  -- (saved-search alerts, new-listing nudges). Required for the
  -- Meta marketing-template eligibility math; service templates
  -- don't need explicit opt-in (the wa.me click is implicit consent).
  marketing_opt_in_count integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  created_at timestamptz not null default now()
);

-- Hot-path indexes.
create unique index idx_wa_numbers_phone on public.whatsapp_numbers(phone_e164);
create index idx_wa_numbers_agent on public.whatsapp_numbers(agent_id);
create index idx_wa_numbers_org on public.whatsapp_numbers(org_id);

-- ─── whatsapp_templates ────────────────────────────────────────────

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  -- Meta template name + language tuple is globally unique inside a
  -- WABA. We store both as text + a unique index on (name, language)
  -- to dedup at the AHO layer.
  name text not null,
  language text not null,
  category text not null check (category in ('marketing', 'utility', 'authentication', 'service')),
  -- The template body with `{{1}}`, `{{2}}` placeholders. Stored
  -- here so we can render the buyer-facing preview in the agent
  -- dashboard without round-tripping to Meta.
  body_template text not null,
  -- Meta's id, assigned on approval. Null until then.
  meta_template_id text,
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected', 'paused', 'disabled')),
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

create unique index idx_wa_templates_name_lang on public.whatsapp_templates(name, language);
create index idx_wa_templates_approval on public.whatsapp_templates(approval_status)
  where approval_status = 'pending';

-- ─── whatsapp_messages ─────────────────────────────────────────────

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  -- Join into the channel-agnostic spine. ON DELETE CASCADE so
  -- deleting a conversation message also clears its WhatsApp twin.
  conversation_message_id uuid not null references public.ai_conversation_messages(id) on delete cascade,
  wa_number_id uuid not null references public.whatsapp_numbers(id) on delete restrict,
  -- Meta's message id (wamid.xxx). Required for matching delivery
  -- callbacks to the original send. Unique across the platform.
  wa_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  -- Set when the outbound is a template send; NULL for free-form
  -- service-window messages.
  template_id uuid references public.whatsapp_templates(id) on delete set null,
  -- True if Meta's 24-hour customer-care window was open at send.
  -- Service-window messages cost $0; template messages outside the
  -- window cost the per-market template rate (see
  -- src/lib/whatsapp/pricing.ts).
  in_service_window boolean not null,
  -- USD cents. 0 for inbound + service-window outbound; computed
  -- per-market via estimateWhatsappCostCents at send time.
  cost_cents integer not null default 0,
  -- sent → delivered → read; or failed at any point. Updated by the
  -- delivery-callback webhook (workers/whatsapp-webhook + the
  -- /api/inbound/whatsapp/status route).
  delivery_status text not null default 'sent' check (delivery_status in ('sent', 'delivered', 'read', 'failed')),
  created_at timestamptz not null default now()
);

create unique index idx_wa_messages_wa_message_id on public.whatsapp_messages(wa_message_id);
create index idx_wa_messages_conv_msg on public.whatsapp_messages(conversation_message_id);
create index idx_wa_messages_wa_number on public.whatsapp_messages(wa_number_id, created_at desc);

-- ─── RLS ───────────────────────────────────────────────────────────

alter table public.whatsapp_numbers enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.whatsapp_messages enable row level security;

-- org_members can read their org's WhatsApp numbers. Mirrors the
-- ai_conversations policy in migration 0066.
create policy "org_members_read_wa_numbers" on public.whatsapp_numbers
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = whatsapp_numbers.org_id
        and om.user_id = auth.uid()
    )
  );

-- org_members can read their org's WhatsApp messages by walking the
-- parent ai_conversation_messages → ai_conversations chain. Same
-- pattern as the ai_conversation_messages select policy in 0066.
create policy "org_members_read_wa_messages" on public.whatsapp_messages
  for select to authenticated
  using (
    exists (
      select 1
      from public.ai_conversation_messages m
      join public.ai_conversations c on c.id = m.conversation_id
      join public.organization_members om on om.org_id = c.org_id
      where m.id = whatsapp_messages.conversation_message_id
        and om.user_id = auth.uid()
    )
  );

-- whatsapp_templates: NO read policy. RLS-enabled + zero policies =
-- service-role-only. The agent dashboard reads approved templates
-- via an explicit API route that whitelists the safe columns.
-- Templates are GLOBAL across the platform — no per-agent visibility
-- semantics to express in RLS.

-- Defense-in-depth: revoke writes from anon + authenticated. RLS
-- with no write policy already blocks; this is the layer the
-- CLAUDE.md gotcha entry (after migration 0065) requires for every
-- new table.
revoke insert, update, delete on public.whatsapp_numbers from anon, authenticated;
revoke insert, update, delete on public.whatsapp_messages from anon, authenticated;
-- whatsapp_templates is service-role-only; revoke ALL grants so even
-- SELECT can't slip through if a future policy is added by mistake.
revoke all on public.whatsapp_templates from anon, authenticated;

comment on table public.whatsapp_numbers is
  'Per-agent WhatsApp Business phone number. Shared AHO WABA model (D4=A in docs/AI_AGENT_PLAN.md). One row per agent-owned line; carries BSP routing keys + the per-number monthly template-spend cap.';

comment on table public.whatsapp_templates is
  'Platform-managed WhatsApp message templates. Global per (name, language). Service-role-only — the agent dashboard reads via an explicit API whitelist.';

comment on table public.whatsapp_messages is
  'Per-message twin joined to the ai_conversation_messages spine. Records Meta wa_message_id, in-service-window flag, per-message USD cost, and delivery status.';
