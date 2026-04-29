-- 0008_subscription_status_fix.sql
--
-- Fixes the subscription-status taxonomy and the priority ordering in the
-- entitlement-denorm trigger. See `DECISIONS.md` "Subscription-status
-- priority ordering correction" for the full rationale.
--
-- Also lays in the founder-rate atomic counter per `DECISIONS.md` "Founder-
-- rate atomic claim: UPDATE ... RETURNING".

-- ============================================================
-- 1. Update CHECK constraint on subscriptions.status
-- ============================================================

-- Stripe statuses: incomplete, incomplete_expired, trialing, active,
-- past_due, canceled (American), unpaid, paused.
-- Our derived: suspended (admin action), expired (post-dunning final state).
alter table public.subscriptions drop constraint if exists subscriptions_status_check;

-- Translate any pre-existing 'cancelled' (British, from 0003) to 'canceled'
-- (Stripe's American spelling) before adding the new constraint.
update public.subscriptions set status = 'canceled' where status = 'cancelled';

alter table public.subscriptions add constraint subscriptions_status_check
  check (status in (
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused',
    'suspended',
    'expired'
  ));

-- ============================================================
-- 2. Replace recompute_org_current_subscription with corrected priority
-- ============================================================

create or replace function public.recompute_org_current_subscription(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub_id uuid;
  v_plan_id text;
  v_status text;
  v_period_end timestamptz;
begin
  select s.id, s.plan_id, s.status, s.current_period_end
    into v_sub_id, v_plan_id, v_status, v_period_end
  from public.subscriptions s
  where s.org_id = p_org_id
  order by
    case s.status
      when 'active'             then 1
      when 'trialing'           then 2
      when 'past_due'           then 3
      when 'canceled'           then 4  -- still in period; access until current_period_end
      when 'paused'             then 5  -- explicitly paused; treat between canceled and dead
      when 'suspended'          then 6  -- our derived: admin action
      when 'unpaid'             then 7  -- Stripe gave up retrying; effectively dead
      when 'expired'            then 8  -- our derived: post-dunning final state
      when 'incomplete'         then 9  -- never paid; effectively non-existent
      when 'incomplete_expired' then 10 -- aged-out incomplete
      else                            11
    end,
    s.current_period_end desc nulls last
  limit 1;

  update public.organizations
    set current_subscription_id = v_sub_id,
        current_plan_id = v_plan_id,
        current_status = v_status,
        current_period_end = v_period_end
    where id = p_org_id;
end $$;

-- ============================================================
-- 3. Founder-rate atomic counter
-- ============================================================

create table if not exists public.founder_rate_counter (
  id int primary key check (id = 1),
  claimed int not null default 0 check (claimed >= 0),
  cap int not null default 50 check (cap >= 0),
  updated_at timestamptz not null default now()
);

insert into public.founder_rate_counter (id, claimed, cap)
  values (1, 0, 50)
  on conflict (id) do nothing;

-- Atomic claim. Returns the new claimed count if a slot was acquired, or
-- NULL if the cap was already reached. Inside the same transaction the
-- caller should also insert a `founder_rate_grants` row; on rollback the
-- counter increment also rolls back.
create or replace function public.claim_founder_rate_slot()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed int;
begin
  update public.founder_rate_counter
    set claimed = claimed + 1, updated_at = now()
    where id = 1 and claimed < cap
    returning claimed into v_claimed;
  return v_claimed; -- null if no row updated (at cap)
end $$;

-- Release a slot — used when a founder-rate subscription is canceled before
-- its first successful billing (pre-billing cancellation refunds the slot).
-- Records release_at on the grant row in the same transaction.
create or replace function public.release_founder_rate_slot(p_subscription_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant_id uuid;
begin
  -- Mark the grant released; only act if it wasn't already released.
  update public.founder_rate_grants
    set released_at = now()
    where subscription_id = p_subscription_id and released_at is null
    returning id into v_grant_id;

  if v_grant_id is null then
    return false;
  end if;

  -- Decrement the counter (floor at 0 in case of double-release race).
  update public.founder_rate_counter
    set claimed = greatest(claimed - 1, 0), updated_at = now()
    where id = 1;

  return true;
end $$;

-- RLS: counter table is service-role only. No policies = no user-context access.
alter table public.founder_rate_counter enable row level security;
