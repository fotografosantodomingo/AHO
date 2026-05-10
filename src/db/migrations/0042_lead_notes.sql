-- 0042_lead_notes.sql
--
-- Per-lead detail page (src/app/[locale]/dashboard/leads/[id]/page.tsx)
-- needs an agent-private notes field on each lead.
--
-- The `notes text` column was introduced alongside the leads table in
-- `0009_leads.sql` (it's been in the schema since the inbox shipped).
-- This migration is idempotent — `add column if not exists` is a no-op
-- where the column already exists, but ensures any environment that
-- somehow predates 0009's notes column gets it before the per-lead
-- detail page tries to render or PUT into it.
--
-- Activity timeline scope decision (logged here so a future reader doesn't
-- wonder why there's no lead_events table): the per-lead detail page
-- renders its timeline from `created_at` + the `updated_at` triggered by
-- status / notes changes. A dedicated `lead_events` audit table was
-- considered and explicitly deferred — agents asked for "see the lead",
-- not "see every keystroke," and the existing `audit_log` table already
-- captures status mutations for compliance. Re-add when the use case
-- materialises (multi-agent threading, email-send tracking, etc.).
--
-- RLS: covered by the existing `leads_org_member_select` and
-- `leads_org_member_update` policies on `public.leads` from 0009. No
-- new policies needed.

alter table public.leads
  add column if not exists notes text;

comment on column public.leads.notes is
  'Agent-private internal notes. RLS-restricted to org members of the '
  'lead''s org via the existing leads_org_member_select/update policies. '
  'Never exposed to the buyer; never returned by /api/leads (POST is '
  'create-only).';
