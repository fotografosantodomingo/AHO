-- 0059_ai_audits.sql
--
-- Phase 1 of docs/SUPER_PRO_STAGE_1_PLAN.md: Free Audit widget on
-- /for-agents. Anonymous visitor pastes a portal listing URL, the
-- server scrapes facts + AI-drafts 9 captions (3 platforms × 3 locales),
-- and stores the result here keyed by a random UUID. The visitor is
-- redirected to /preview/[id] which renders the captions and prompts
-- signup to publish.
--
-- Access model:
--   - Public SELECT — anyone with the UUID can read the audit (the
--     preview page is intentionally public; the UUID is the secret).
--   - No anon INSERT / UPDATE / DELETE — only the service-role client
--     (running inside /api/audit/start) can write rows. RLS without
--     a write policy denies anon by default.
--   - Owner-claim flow: when an authed user later signs up from the
--     preview screen, the server-side claim handler stamps
--     claimed_by_user_id; once claimed it's tied to that user's
--     dashboard and survives the 7-day TTL.
--
-- Pruning: a future cron deletes WHERE expires_at < now() AND
-- claimed_by_user_id IS NULL — unclaimed audits self-evict after 7
-- days so the table stays small. (Cron deferred to a later slice.)

create table public.ai_audits (
  id uuid primary key default gen_random_uuid(),
  -- Source data
  source_url text not null,
  source_locale text,
  facts jsonb not null,
  drafts jsonb not null,
  -- Cost accounting (per the plan's unit-economics target ≤ $0.30/audit)
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  -- Bot-abuse forensics: SHA-256 hex of the client IP. Anonymized so
  -- we can detect repeat-offender patterns without storing raw IPs.
  client_ip_hash text,
  -- Claim — set when an authed user signs up from /preview/[id]
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  -- Lifecycle
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

comment on table public.ai_audits is
  'Anonymous Free Audit results from /for-agents URL paste. Public SELECT by UUID. Per Super Pro Stage 1 Phase 1.';

create index ai_audits_expires_at_idx
  on public.ai_audits (expires_at)
  where claimed_by_user_id is null;

create index ai_audits_claimed_by_user_id_idx
  on public.ai_audits (claimed_by_user_id)
  where claimed_by_user_id is not null;

alter table public.ai_audits enable row level security;

-- Public read by UUID. The preview page is intentionally accessible to
-- anonymous visitors before they sign up — that's the conversion path.
create policy ai_audits_public_select
  on public.ai_audits
  for select
  to public
  using (true);

-- No INSERT / UPDATE / DELETE policies → anon clients can only read.
-- Server-side writes go through the service-role client which bypasses
-- RLS.

grant select on public.ai_audits to anon, authenticated;
