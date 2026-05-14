-- ============================================================
-- 0055_email_marketing
--
-- Admin email-marketing data model. Inspired by the email-campaigns
-- skill (skills/email-campaigns/database/01_email_marketing.sql) but
-- rebuilt for AHO conventions: single-locale segmenting via existing
-- profiles + leads, no separate email_contacts surface (we don't have
-- cold imports yet), HashiCorp-style tokens (no skill-side CSS).
--
-- Three tables:
--   email_campaigns   — one row per send. Stores subject, html, segment
--                       key, status, and aggregate counters.
--   email_messages    — one row per recipient per campaign. Holds the
--                       Brevo message_id for later webhook correlation
--                       + per-event timestamps.
--   email_unsubscribes — authoritative blocklist (PK = email). Consulted
--                       on every send. Also synced to Brevo blocklist
--                       by the unsubscribe handler.
--
-- profiles.email_marketing_opt_in is added here too. Default false ⇒
-- agents/buyers must explicitly opt in. GDPR + Brevo policy both
-- require this; marketing send happens only against opt-in users.
-- Transactional sends (welcome, lead-received, billing) bypass the flag
-- and continue using the existing src/lib/email/brevo.ts wrapper.
--
-- RLS: super_admin only via the existing is_platform_admin() helper.
-- Service role used by the send + webhook routes bypasses RLS.
-- ============================================================

-- --------------------------------------------------------------
-- profiles.email_marketing_opt_in
-- --------------------------------------------------------------

alter table public.profiles
  add column if not exists email_marketing_opt_in boolean not null default false;

create index if not exists idx_profiles_marketing_optin
  on public.profiles(email_marketing_opt_in) where email_marketing_opt_in = true;

-- --------------------------------------------------------------
-- email_campaigns
-- --------------------------------------------------------------

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  html_body text not null,
  -- Plain-text fallback. Optional. Auto-derived from html on save if
  -- omitted (composer responsibility).
  text_body text,
  -- One of the keys returned by list_email_segments(). Composer picks
  -- from a dropdown. Free text here so future custom segments don't
  -- need an enum migration.
  segment_key text not null,
  -- draft → sending → sent | failed.
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'failed')),
  -- Aggregate counters updated by the send route + the brevo webhook
  -- handler. Cheap to maintain; avoids a full email_messages scan on
  -- every dashboard render.
  recipient_count int not null default 0,
  delivered_count int not null default 0,
  opened_count int not null default 0,
  clicked_count int not null default 0,
  bounced_count int not null default 0,
  unsubscribed_count int not null default 0,
  sent_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_campaigns_status_created
  on public.email_campaigns(status, created_at desc);

create trigger email_campaigns_touch_updated_at
  before update on public.email_campaigns
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------
-- email_messages
-- --------------------------------------------------------------

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  email citext not null,
  -- Snapshot of the recipient's profile.id at send time, if any. Lets
  -- us tie a click-through back to a specific user. NULL for emails
  -- sent to addresses outside profiles (future-proof for cold lists).
  user_id uuid references public.profiles(id),
  -- Brevo's message ID returned from /v3/smtp/email. Indexed because
  -- the webhook handler looks up by this. NULL until the send POST
  -- returns (covers the brief window between row-insert and Brevo
  -- response; rows still get inserted upfront so a Brevo failure is
  -- visible in the per-recipient log).
  brevo_message_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed')),
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  bounce_reason text,
  error_message text,
  created_at timestamptz not null default now(),
  -- Dedup key: don't insert two rows for the same (campaign, email)
  -- combination if the send route retries.
  unique (campaign_id, email)
);

create index if not exists idx_email_messages_campaign
  on public.email_messages(campaign_id);
create index if not exists idx_email_messages_brevo_id
  on public.email_messages(brevo_message_id) where brevo_message_id is not null;
create index if not exists idx_email_messages_email
  on public.email_messages(email);

-- --------------------------------------------------------------
-- email_unsubscribes
-- --------------------------------------------------------------

create table if not exists public.email_unsubscribes (
  email citext primary key,
  unsubscribed_at timestamptz not null default now(),
  source text not null default 'link'
    check (source in ('link', 'brevo_webhook', 'admin', 'bounce_permanent'))
);

-- --------------------------------------------------------------
-- RLS — admin-only for tables; service role bypasses
-- --------------------------------------------------------------

alter table public.email_campaigns enable row level security;
alter table public.email_messages enable row level security;
alter table public.email_unsubscribes enable row level security;

drop policy if exists email_campaigns_admin_all on public.email_campaigns;
create policy email_campaigns_admin_all on public.email_campaigns
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists email_messages_admin_select on public.email_messages;
create policy email_messages_admin_select on public.email_messages
  for select
  using (public.is_platform_admin());

drop policy if exists email_unsubscribes_admin_select on public.email_unsubscribes;
create policy email_unsubscribes_admin_select on public.email_unsubscribes
  for select
  using (public.is_platform_admin());
