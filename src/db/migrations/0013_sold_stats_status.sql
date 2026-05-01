-- 0013_sold_stats_status.sql
-- Phase 1A of the agent-profile build.
--
-- 1. Properties: add sold-side fields (sold_date, sold_price_cents,
--    represented_side, closing_notes), expand status enum with
--    'coming_soon', and add primary_agent_id (the v1.1 multi-agent hook).
-- 2. Profiles: add stats cache columns recomputed by trigger.
-- 3. audit_log table — first-class. Admin actions code (setUserAdmin)
--    has been writing to this table for weeks but it never existed →
--    inserts were silently failing. Create it + RLS + index here.
-- 4. Triggers:
--    a. BEFORE UPDATE on properties: when status flips to sold/rented,
--       require sold_date. Price stays optional (confidential closings).
--    b. AFTER INSERT/UPDATE/DELETE on properties: recompute stats for
--       the owning agent (primary_agent_id ?? created_by). Auth-context-
--       agnostic so admin-driven status flips also recompute.

-- --------------------------------------------------------------------
-- 1. Properties: sold fields + primary_agent_id + coming_soon status
-- --------------------------------------------------------------------

alter table public.properties
  add column if not exists sold_date timestamptz,
  add column if not exists sold_price_cents bigint check (
    sold_price_cents is null or sold_price_cents > 0
  ),
  add column if not exists represented_side text check (
    represented_side is null or represented_side in ('buyer','seller','both')
  ),
  add column if not exists closing_notes text,
  -- v1.1 multi-agent forward-compat: when an org gets a second agent,
  -- the listing's "primary" agent (whose stats include this row) is
  -- explicit. NULL = fall back to `created_by` (which is what every v1
  -- listing has, since 1 agent per org). DO NOT remove this column or
  -- the stats trigger's coalesce(primary_agent_id, created_by) breaks.
  add column if not exists primary_agent_id uuid references public.profiles(id);

-- Add 'coming_soon' to the status enum. The status is a CHECK constraint
-- (not a Postgres enum type), so we drop + recreate it.
alter table public.properties drop constraint if exists properties_status_check;
alter table public.properties add constraint properties_status_check check (
  status in ('draft','active','pending','sold','rented','archived','coming_soon')
);

-- --------------------------------------------------------------------
-- 2. Profiles: stats cache columns
-- --------------------------------------------------------------------

alter table public.profiles
  add column if not exists stats_total_sales int not null default 0,
  add column if not exists stats_sales_12mo int not null default 0,
  add column if not exists stats_price_min_cents bigint,
  add column if not exists stats_price_max_cents bigint,
  -- AVG ignores NULL by default in SQL — so a confidential sold listing
  -- (sold_price_cents = NULL) does NOT pull avg toward 0. It's just
  -- excluded from the average. This matches the spec.
  add column if not exists stats_avg_price_cents bigint,
  add column if not exists stats_recomputed_at timestamptz;

-- --------------------------------------------------------------------
-- 3. audit_log — first-class table (was implicitly assumed by admin code)
-- --------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- e.g. 'listing.marked_sold', 'listing.archived', 'admin.user.promoted'
  kind text not null,
  -- The user who performed the action. NULL allowed for system/cron
  -- recompute jobs (none today; reserved).
  actor_id uuid references public.profiles(id),
  -- The entity the action targeted (a property id, a profile id, etc.).
  -- Loose typing intentional — we record what was acted on, not what
  -- table it lived in.
  target_id uuid,
  -- Free-form snapshot. For listing.marked_sold:
  -- { prior_status, sold_date, sold_price_cents, represented_side, notes }
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_target on public.audit_log(target_id, created_at desc);
create index if not exists idx_audit_log_kind on public.audit_log(kind, created_at desc);
create index if not exists idx_audit_log_actor on public.audit_log(actor_id, created_at desc) where actor_id is not null;

alter table public.audit_log enable row level security;

-- INSERT: any authenticated user can write a row, but only with
-- their own actor_id. Service-role bypasses RLS as always.
create policy audit_log_self_insert
  on public.audit_log for insert
  to authenticated
  with check (actor_id = (select auth.uid()));

-- SELECT: admins read everything. Regular users read rows they wrote
-- (so the agent dashboard can render "your activity" later).
create policy audit_log_admin_select
  on public.audit_log for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

create policy audit_log_self_select
  on public.audit_log for select
  to authenticated
  using (actor_id = (select auth.uid()));

-- No UPDATE / DELETE policies — audit log is append-only. Service-role
-- can prune via raw SQL if retention policy demands it later.

-- --------------------------------------------------------------------
-- 4a. Trigger: require sold_date when status enters sold/rented
-- --------------------------------------------------------------------

create or replace function public.require_sold_date_on_close()
returns trigger
language plpgsql
as $$
begin
  -- Only enforce on transitions INTO sold/rented (not edits of an
  -- already-sold row that omit the date — the column is already set).
  if new.status in ('sold','rented') and (old.status is null or old.status not in ('sold','rented')) then
    if new.sold_date is null then
      -- Default to now() if the caller didn't provide one. Better UX
      -- than a hard reject — the date is the timestamp of the
      -- transition, which we know.
      new.sold_date := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_properties_require_sold_date on public.properties;
create trigger trg_properties_require_sold_date
  before update on public.properties
  for each row
  when (new.status is distinct from old.status)
  execute function public.require_sold_date_on_close();

-- --------------------------------------------------------------------
-- 4b. Trigger: recompute agent stats on any sold-state change
-- --------------------------------------------------------------------

create or replace function public.recompute_agent_stats(p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_agent_id is null then return; end if;

  update public.profiles set
    stats_total_sales = (
      select count(*) from public.properties
      where coalesce(primary_agent_id, created_by) = p_agent_id
        and status = 'sold'
    ),
    stats_sales_12mo = (
      select count(*) from public.properties
      where coalesce(primary_agent_id, created_by) = p_agent_id
        and status = 'sold'
        and sold_date >= now() - interval '12 months'
    ),
    stats_price_min_cents = (
      select min(sold_price_cents) from public.properties
      where coalesce(primary_agent_id, created_by) = p_agent_id
        and status = 'sold'
        and sold_date >= now() - interval '3 years'
    ),
    stats_price_max_cents = (
      select max(sold_price_cents) from public.properties
      where coalesce(primary_agent_id, created_by) = p_agent_id
        and status = 'sold'
        and sold_date >= now() - interval '3 years'
    ),
    stats_avg_price_cents = (
      -- AVG() naturally ignores NULL — confidential closings (price
      -- omitted) are excluded from the average rather than dragging it
      -- toward 0.
      select avg(sold_price_cents)::bigint from public.properties
      where coalesce(primary_agent_id, created_by) = p_agent_id
        and status = 'sold'
        and sold_date >= now() - interval '3 years'
    ),
    stats_recomputed_at = now()
  where id = p_agent_id;
end;
$$;

create or replace function public.trigger_recompute_agent_stats()
returns trigger
language plpgsql
as $$
declare
  v_old_agent uuid;
  v_new_agent uuid;
  v_should_run boolean := false;
begin
  -- Gate: only run when something stats-relevant actually changed.
  -- (TG_OP can't be referenced in CREATE TRIGGER's WHEN clause; we
  -- gate inside the function instead. The function is cheap; the
  -- recompute_agent_stats call is the expensive part.)
  if tg_op = 'INSERT' and new.status = 'sold' then
    v_should_run := true;
  elsif tg_op = 'DELETE' and old.status = 'sold' then
    v_should_run := true;
  elsif tg_op = 'UPDATE' and (
    new.status is distinct from old.status or
    new.sold_date is distinct from old.sold_date or
    new.sold_price_cents is distinct from old.sold_price_cents or
    new.primary_agent_id is distinct from old.primary_agent_id
  ) then
    v_should_run := true;
  end if;

  if not v_should_run then
    return null;
  end if;

  if tg_op in ('UPDATE','DELETE') then
    v_old_agent := coalesce(old.primary_agent_id, old.created_by);
    perform public.recompute_agent_stats(v_old_agent);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    v_new_agent := coalesce(new.primary_agent_id, new.created_by);
    if v_new_agent is distinct from v_old_agent then
      perform public.recompute_agent_stats(v_new_agent);
    end if;
  end if;
  return null; -- AFTER trigger; return value ignored
end;
$$;

drop trigger if exists trg_properties_recompute_stats on public.properties;
create trigger trg_properties_recompute_stats
  after insert or update or delete on public.properties
  for each row
  execute function public.trigger_recompute_agent_stats();

-- One-time backfill: recompute stats for every distinct agent that has
-- at least one sold listing. Cheap on an empty production; cost grows
-- linearly with sold count later.
do $$
declare
  agent_id uuid;
begin
  for agent_id in
    select distinct coalesce(primary_agent_id, created_by) as id
    from public.properties
    where status = 'sold'
  loop
    perform public.recompute_agent_stats(agent_id);
  end loop;
end $$;
