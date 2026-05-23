-- 0077_founding_agent_applications.sql
--
-- Founding 50 program — table that captures DR agent (and global)
-- recruitment leads from the /founding-agent landing page.
--
-- Context: the wedge-funnel surfaces all over the public site point
-- at /for-agents#free-audit (low-commitment Free Audit). The Founding
-- 50 program is a HIGHER-commitment parallel funnel: an agent fills
-- out a short form (WhatsApp + city + listings portfolio URL), gets a
-- welcome email, and the operator gets an alert email — that's the
-- CEO's CRM-lite for soft-beta recruitment. Permanent founder rate is
-- locked for applications received before the cap is hit.
--
-- Shape: applied → contacted → onboarding → converted (subscribed)
--             ↓
--          declined (rare — applied but not a fit)
--
-- RLS: deny-all default — service-role bypass + admin-only read via
-- the `is_admin()` function. The public form writes via the API route
-- (service role), NOT via PostgREST direct insert (the API does
-- rate-limit + validation + the dual-email side-effect).

create table public.founding_agent_applications (
  id uuid primary key default gen_random_uuid(),

  -- Contact info — minimal fields, no auth signup required for v1.
  full_name text not null check (char_length(full_name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  whatsapp text check (whatsapp is null or char_length(whatsapp) between 6 and 40),
  city text not null check (char_length(city) between 2 and 80),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),

  -- Optional listings portfolio link (their personal website,
  -- realtor.com profile, idealista vendor page, etc.). Helps the
  -- operator pre-qualify before the first call.
  portfolio_url text check (portfolio_url is null or portfolio_url ~* '^https?://'),

  -- Free-text "anything you want to tell us" — capped to prevent
  -- abuse. Stored verbatim; operator reads in the admin view.
  message text check (message is null or char_length(message) <= 2000),

  -- Funnel status. Default 'applied'; operator advances via the
  -- admin view as the agent moves through the pipeline.
  status text not null default 'applied' check (
    status in ('applied', 'contacted', 'onboarding', 'converted', 'declined')
  ),

  -- Operator notes — internal, never shown to the applicant.
  operator_notes text check (operator_notes is null or char_length(operator_notes) <= 4000),

  -- Idempotency / abuse defense — the API route hashes the client IP
  -- + email to dedup repeat submissions within a window.
  submission_ip_hash text,

  -- UTM-style attribution so we can later attribute conversions back
  -- to specific outreach channels (e.g. utm_source=whatsapp,
  -- utm_campaign=dr-may-2026). Optional + ad-hoc.
  utm_source text,
  utm_campaign text,

  applied_at timestamptz not null default now(),
  contacted_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_founding_agent_applications_status
  on public.founding_agent_applications(status, applied_at desc);

create index idx_founding_agent_applications_email
  on public.founding_agent_applications(lower(email));

create index idx_founding_agent_applications_country
  on public.founding_agent_applications(country_code, applied_at desc);

-- Touch updated_at on any row update.
create trigger founding_agent_applications_touch_updated_at
  before update on public.founding_agent_applications
  for each row execute function public.touch_updated_at();

-- ─── RLS — deny-all default; service-role + admin only ──────────────

alter table public.founding_agent_applications enable row level security;

-- Read policy for admins (the dashboard /admin/founding-agents view).
-- The is_platform_admin() helper is defined in 0002_identity.sql —
-- it reads profiles.is_admin for auth.uid() and returns boolean.
-- All other reads denied.
create policy founding_agent_applications_admin_select
  on public.founding_agent_applications
  for select
  to authenticated
  using (public.is_platform_admin());

create policy founding_agent_applications_admin_update
  on public.founding_agent_applications
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No INSERT policy for authenticated/anon — the public form writes
-- via service-role through the /api/founding-agent route, which
-- does rate-limit + validation. Direct PostgREST inserts blocked.

-- ─── Belt-and-suspenders: explicit REVOKE on anon + authenticated ──
-- Supabase auto-grants SELECT/INSERT/UPDATE/DELETE to anon +
-- authenticated on every new table. RLS with our policies blocks
-- reads/writes in practice, but defense-in-depth (per the
-- 0065_revoke_extra_grants pattern + CLAUDE.md local-dev quirk).

revoke insert, delete, truncate on public.founding_agent_applications from anon, authenticated;

comment on table public.founding_agent_applications is
  'Founding 50 program recruitment funnel. Public form at /[locale]/founding-agent writes here via the service-role-backed /api/founding-agent route. Admin tracks status + notes via /[locale]/admin/founding-agents. Permanent founder rate is granted for applications that reach status=''converted'' before the cap (50 globally for v1; track via count in the admin view).';

comment on column public.founding_agent_applications.status is
  'Funnel stage: applied (just submitted) → contacted (operator reached out) → onboarding (in the signup + connect-IG flow) → converted (active paying subscriber on a founder-rate plan) OR declined (applied but not a fit; rare).';
