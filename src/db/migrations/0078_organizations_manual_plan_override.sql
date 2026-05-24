-- 0078_organizations_manual_plan_override.sql
--
-- Admin-grantable plan overrides for the soft-beta / Founding 50
-- recruitment phase. Lets the operator comp an agent ("free 90 days
-- of Pro Automation"), extend a paid period, or set a permanent
-- founder-rate tier without going through Stripe — which is in TEST
-- mode today + irrelevant for hand-recruited soft-beta agents.
--
-- Design: 5 columns on `organizations`. NULL `manual_plan_id` means
-- "no override; use Stripe-derived current_plan_id." Non-NULL
-- `manual_plan_id` overrides for as long as `manual_plan_expires_at`
-- is in the future (or NULL = permanent, used for Founding 50).
--
-- The full grant/extend/revoke history goes into the existing
-- `audit_log` table via the admin API route, NOT a dedicated
-- comp-history table. Reasons:
--   1. audit_log already has `kind`, `actor_id`, `target_id`, `payload`
--      — exactly what we need.
--   2. Avoids a new table to maintain + RLS to test for a low-frequency
--      audit trail (soft-beta era = <100 grants total).
--   3. Operator can pull history with a single `select * from audit_log
--      where target_id = <org_id> and kind ilike 'admin.org.plan_%'`.
--
-- RLS: organizations already has RLS configured (members can read own
-- org). The new columns inherit that — readable by org members.
-- Write path is admin-only via /api/admin/orgs/[id]/plan-override
-- which uses the service-role client after an is_platform_admin()
-- check; no new policy needed.

alter table public.organizations
  add column if not exists manual_plan_id text
    check (manual_plan_id is null or manual_plan_id in (
      -- Whitelist mirrors PRO_AUTOMATION_PLAN_IDS + ANY_PAID_PLAN_IDS
      -- from src/lib/billing/plan-gating.ts. Keep in sync if the
      -- plan-id taxonomy changes.
      'aho_agent_monthly',
      'aho_agent_annual',
      'aho_agent_founder_monthly',
      'aho_plus_monthly',
      'aho_plus_annual',
      'aho_pro_automation_monthly',
      'aho_pro_automation_annual'
    )),
  add column if not exists manual_plan_expires_at timestamptz,
  add column if not exists manual_plan_note text
    check (manual_plan_note is null or char_length(manual_plan_note) <= 1000),
  add column if not exists manual_plan_granted_by uuid references public.profiles(id),
  add column if not exists manual_plan_granted_at timestamptz;

-- Partial index — most orgs have no manual override; only the
-- minority do. The lookup pattern is "is this org currently overridden?"
-- WHERE manual_plan_id IS NOT NULL filters out the dominant non-override
-- case so the index is small + cheap to scan.
create index if not exists idx_organizations_manual_plan_active
  on public.organizations(manual_plan_id, manual_plan_expires_at)
  where manual_plan_id is not null;

comment on column public.organizations.manual_plan_id is
  'Admin-granted plan override. NULL = use Stripe-derived current_plan_id (default). Non-NULL = the override tier; effective when (manual_plan_expires_at IS NULL OR > now()). Set + cleared via /api/admin/orgs/[id]/plan-override. Full grant/extend/revoke history in audit_log under kind ''admin.org.plan_comp_*''.';

comment on column public.organizations.manual_plan_expires_at is
  'When the manual override stops applying. NULL means permanent (used for Founding 50 founder-rate grants). Stripe-derived current_plan_id remains the source of truth once this passes.';

comment on column public.organizations.manual_plan_note is
  'Free-text reason the override was granted (e.g. "Founding 50 — DR launch", "comp 60d soft-beta"). Internal; never shown to org members.';

comment on column public.organizations.manual_plan_granted_by is
  'Admin profile id that granted (or last extended) the override. Stamped via the API route.';

comment on column public.organizations.manual_plan_granted_at is
  'Timestamp of the most recent grant/extend action. Together with manual_plan_granted_by gives provenance at-a-glance without an audit_log lookup.';
