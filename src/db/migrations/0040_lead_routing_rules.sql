-- 0040_lead_routing_rules.sql
--
-- Lead-routing rules engine (MVP). Today every inbound lead from the
-- contact-form on a property page gets attributed to the property's
-- primary agent (`properties.created_by`). That works for solo agents
-- but breaks down for agencies who want to:
--
--   - Send leads from city X to agent Y
--   - Round-robin leads within a region across N agents
--   - Send leads from a particular language preference to a multilingual
--     agent
--   - Apply a fallback when the property's primary agent is on vacation
--
-- This migration introduces two tables:
--
--   1. `lead_routing_rules` — declarative per-org rules with conditions
--      (city / country_code / language / property_type) and an action
--      (assign-to-user OR round-robin across a list of users). Evaluated
--      in priority order at lead-creation time by the API route; first
--      match wins. No match → fall back to the property's primary agent
--      (existing behavior preserved for solo agents who define no rules).
--
--   2. `lead_routing_state` — per-org cursor row holding the index of
--      the last round-robin pick. The runtime increments + wraps
--      modulo the round-robin set size so cycles are deterministic and
--      cheap to compute (no aggregate query at lead-creation time on
--      the hot path).
--
-- Why a cursor row over "count assignments per agent in last 30d, pick
-- lowest":
--   - O(1) state lookup vs an aggregate scan over `leads` per insert.
--   - Deterministic cycling lets us unit-test the engine as a pure
--     function (input rules + cursor state → next assignee + new
--     cursor). The "lowest count" approach depends on existing lead
--     rows, which would force the test to populate fixture leads to
--     exercise rotation, and would be sensitive to the 30-day window
--     boundary moving during test runs.
--   - Simpler RLS posture: one row per org, owner-readable.
--   - Trade-off: cursor doesn't auto-rebalance after a member is
--     removed mid-cycle. v1.1 can either reset the cursor on member
--     change or switch to count-based — captured as a follow-up.
--
-- RLS posture:
--   - SELECT: any org member (owner / manager / agent / analyst /
--     viewer) reads their org's rules. Agents read so the dashboard's
--     debug view "this lead matched rule X" can render rule names.
--   - INSERT / UPDATE / DELETE: owner + manager only. Agents cannot
--     change routing — they're the targets of routing.
--   - Admin: all (escape hatch).
--   - Service role: bypasses RLS as always.
--
-- The rule-evaluation runtime in `src/lib/leads/routing.ts` is a pure
-- TS function, so the conditions JSONB shape is interpreted there
-- rather than in SQL. Schema-side we only enforce that `conditions`
-- and `action` are valid JSON objects; the TS layer narrows further.

-- ============================================================
-- lead_routing_rules
-- ============================================================

create table if not exists public.lead_routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  /** Higher number wins; same priority falls back to created_at asc.
   *  v1 expects 0..100 — small ints help admins reason about ordering. */
  priority integer not null default 0,
  /** Human-readable label rendered in the dashboard table.
   *  Required for UX clarity — anonymous "rule abc-123" rows don't help
   *  an agency owner remember why they wrote them. */
  name text not null,
  /** Conditions JSON shape (kept simple for v1):
   *  {
   *    "city": "Mexico City",       // optional, exact match
   *    "country_code": "MX",        // optional, ISO-3166-1 alpha-2
   *    "language": "es",            // optional, lead's preferred locale
   *    "property_type": "apartment" // optional
   *  }
   *  Empty object {} matches everything (use as an org-wide default
   *  with low priority). All fields AND together; only the present
   *  fields are checked. */
  conditions jsonb not null default '{}'::jsonb,
  /** Action JSON shape:
   *  - { "type": "assign", "assign_to_user_id": "<uuid>" }
   *  - { "type": "round_robin", "round_robin_user_ids": ["<uuid>", ...] }
   *  v1 supports the two action types above. v1.1 candidates: weighted
   *  round-robin (hash by buyer email), time-of-day routing, escalation. */
  action jsonb not null,
  /** Toggle without deleting — preserves audit / "we tried this for a
   *  week" history. Inactive rules are skipped during evaluation. */
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** Belt-and-suspenders: action.type must be one of the two known
   *  variants. Keeps a typo'd UI from inserting unroutable rules. */
  constraint lead_routing_rules_action_type_valid
    check (action ? 'type' and action->>'type' in ('assign','round_robin'))
);

-- The hot lookup at lead-creation time is "all active rules for this
-- org, highest priority first". Partial index keeps it tight.
create index if not exists idx_lead_routing_rules_org_priority_active
  on public.lead_routing_rules (org_id, priority desc, created_at)
  where is_active = true;

create trigger lead_routing_rules_touch_updated_at
  before update on public.lead_routing_rules
  for each row execute function public.touch_updated_at();

-- ============================================================
-- lead_routing_state — round-robin cursor (one row per org)
-- ============================================================
--
-- The cursor is org-scoped, not rule-scoped, because v1 only supports
-- one active round-robin at a time per match (first matching rule
-- wins). If two round-robin rules can't both fire on the same lead,
-- one cursor per org is sufficient. v1.1 can promote to a per-rule
-- cursor (composite PK) without breaking the engine API.

create table if not exists public.lead_routing_state (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  /** 0-based index into the rule's `round_robin_user_ids` array. The
   *  runtime reads this, picks `users[idx % len]`, and writes back
   *  `(idx + 1) % len`. Wrap is computed by the runtime, not stored,
   *  so changing the rule's user list mid-cycle just shifts targets
   *  rather than breaking. */
  last_round_robin_index integer not null default 0,
  updated_at timestamptz not null default now()
);

create trigger lead_routing_state_touch_updated_at
  before update on public.lead_routing_state
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS — lead_routing_rules
-- ============================================================

alter table public.lead_routing_rules enable row level security;

-- SELECT — any org member reads their org's rules.
drop policy if exists lead_routing_rules_org_member_select
  on public.lead_routing_rules;
create policy lead_routing_rules_org_member_select
  on public.lead_routing_rules
  for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = lead_routing_rules.org_id
        and om.user_id = auth.uid()
    )
  );

-- INSERT — owner + manager only.
drop policy if exists lead_routing_rules_owner_insert
  on public.lead_routing_rules;
create policy lead_routing_rules_owner_insert
  on public.lead_routing_rules
  for insert
  with check (
    exists (
      select 1 from public.organization_members om
      where om.org_id = lead_routing_rules.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager')
    )
  );

-- UPDATE — owner + manager only.
drop policy if exists lead_routing_rules_owner_update
  on public.lead_routing_rules;
create policy lead_routing_rules_owner_update
  on public.lead_routing_rules
  for update
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = lead_routing_rules.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager')
    )
  )
  with check (
    exists (
      select 1 from public.organization_members om
      where om.org_id = lead_routing_rules.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager')
    )
  );

-- DELETE — owner + manager only.
drop policy if exists lead_routing_rules_owner_delete
  on public.lead_routing_rules;
create policy lead_routing_rules_owner_delete
  on public.lead_routing_rules
  for delete
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = lead_routing_rules.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager')
    )
  );

-- Admin escape hatch.
drop policy if exists lead_routing_rules_admin_all
  on public.lead_routing_rules;
create policy lead_routing_rules_admin_all
  on public.lead_routing_rules
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- RLS — lead_routing_state
-- ============================================================
--
-- The cursor is updated by the lead-creation API which runs as the
-- service role; user-context writes are not part of the production
-- flow. We allow owner/manager SELECT for debug visibility ("the next
-- lead routed by rule X will go to agent #N"); no user-context
-- INSERT/UPDATE/DELETE — those go through the service role.

alter table public.lead_routing_state enable row level security;

drop policy if exists lead_routing_state_owner_select
  on public.lead_routing_state;
create policy lead_routing_state_owner_select
  on public.lead_routing_state
  for select
  using (
    exists (
      select 1 from public.organization_members om
      where om.org_id = lead_routing_state.org_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager')
    )
  );

drop policy if exists lead_routing_state_admin_all
  on public.lead_routing_state;
create policy lead_routing_state_admin_all
  on public.lead_routing_state
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

comment on table public.lead_routing_rules is
  'Per-org declarative routing rules for inbound leads. Evaluated by '
  'src/lib/leads/routing.ts at /api/leads creation time, highest priority '
  'first. No match → fall back to property.created_by (legacy behavior).';

comment on table public.lead_routing_state is
  'Round-robin cursor (one row per org) for the lead-routing engine. '
  'Updated by service role only; readable by owner/manager for dashboard '
  'debug visibility.';
