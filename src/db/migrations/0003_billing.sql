-- 0003_billing.sql
-- Billing tables: plans, subscriptions, payments, stripe_events_processed, founder_rate_grants.
-- See docs/HANDOFF.md §4.2 + §7 and docs/DECISIONS.md "Pricing locked",
-- "Founder-rate pricing is application-gated", "Stripe trial period on Price".

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.plans (
  id text primary key,                                  -- e.g. 'aho_agent_monthly'
  tier text not null check (tier in ('premium','agent','agency','expert')),
  billing_period text not null check (billing_period in ('monthly','annual')),
  stripe_product_id text not null,
  stripe_price_id text not null unique,
  display_name_en text not null,
  display_name_es text not null,
  description_en text,
  description_es text,
  amount_cents bigint not null,                         -- bigint per CRITIQUE §C
  currency char(3) not null default 'USD',
  trial_days int not null default 0,
  listing_cap int,                                      -- null = unlimited
  seats_included int not null default 1,
  features jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  -- is_visible=false means the price exists in Stripe and our table, but does
  -- not appear on /pricing. Founder rate uses this flag (per DECISIONS.md
  -- "Founder-rate pricing is application-gated").
  is_visible boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger plans_touch_updated_at
  before update on public.plans
  for each row execute function public.touch_updated_at();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete restrict,
  user_id uuid references public.profiles(id),         -- null in v1 (Premium tier is v1.1)
  plan_id text not null references public.plans(id),
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  status text not null check (status in (
    'trialing','active','past_due','cancelled','expired','suspended','incomplete'
  )),
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (org_id is not null or user_id is not null)
);

create index if not exists idx_subs_status on public.subscriptions(status);
create index if not exists idx_subs_stripe_cust on public.subscriptions(stripe_customer_id);
create index if not exists idx_subs_org on public.subscriptions(org_id);
create index if not exists idx_subs_user on public.subscriptions(user_id) where user_id is not null;

create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.touch_updated_at();

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete set null,
  stripe_payment_intent_id text unique,
  stripe_invoice_id text,
  amount_cents bigint not null,
  currency char(3) not null,
  status text not null check (status in (
    'succeeded','failed','refunded','partially_refunded','pending'
  )),
  failure_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_subscription on public.payments(subscription_id);
create index if not exists idx_payments_invoice on public.payments(stripe_invoice_id);

-- Stripe event idempotency table. Used by the webhook handler to dedupe
-- redelivered events. RLS enabled with no user-context policies — locked
-- down except for service role.
create table if not exists public.stripe_events_processed (
  stripe_event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload_summary jsonb
);

-- Founder-rate grant ledger. Per DECISIONS.md "Founder-rate pricing is
-- application-gated": we count `released_at IS NULL` rows to enforce the
-- 50-cap. The webhook handler uses pg_advisory_xact_lock around the
-- "count + grant" sequence to make the check race-safe.
create table if not exists public.founder_rate_grants (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null unique references public.subscriptions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  released_at timestamptz,
  original_price_id text not null,                     -- the Stripe founder price ID at grant time
  check (released_at is null or released_at >= granted_at)
);

create index if not exists idx_founder_active
  on public.founder_rate_grants(user_id) where released_at is null;

-- ============================================================
-- RLS
-- ============================================================

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.stripe_events_processed enable row level security;
alter table public.founder_rate_grants enable row level security;

-- ----- plans -----------------------------------------------------------
-- Public read of active+visible plans (the /pricing page is anonymous-friendly).
-- Founder rate is is_visible=false; only assignable via application logic.

drop policy if exists plans_public_select on public.plans;
create policy plans_public_select on public.plans
  for select
  using (is_active = true and is_visible = true);

drop policy if exists plans_admin_select on public.plans;
create policy plans_admin_select on public.plans
  for select
  using (public.is_platform_admin());

-- (No insert/update/delete for users. Service role bypasses RLS for seeding.)

-- ----- subscriptions ---------------------------------------------------
-- Org members (any role) can see their org's sub — useful for the agent UI to
-- show "you're on Agent monthly, billed on the 5th". Modifications happen via
-- service role from the Stripe webhook handler.

drop policy if exists subscriptions_org_member_select on public.subscriptions;
create policy subscriptions_org_member_select on public.subscriptions
  for select
  using (
    org_id is not null
    and exists (
      select 1 from public.organization_members om
      where om.org_id = subscriptions.org_id
        and om.user_id = auth.uid()
    )
  );

-- Premium buyer subs (v1.1) — the user themselves can see their own.
drop policy if exists subscriptions_user_self_select on public.subscriptions;
create policy subscriptions_user_self_select on public.subscriptions
  for select
  using (user_id = auth.uid());

drop policy if exists subscriptions_admin_all on public.subscriptions;
create policy subscriptions_admin_all on public.subscriptions
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ----- payments --------------------------------------------------------
-- Org owners and managers can see payment rows for their org's subscriptions.
-- Plain agents do not see billing line items by default (privacy / org hygiene).

drop policy if exists payments_org_admin_select on public.payments;
create policy payments_org_admin_select on public.payments
  for select
  using (
    exists (
      select 1
      from public.subscriptions s
      join public.organization_members om on om.org_id = s.org_id
      where s.id = payments.subscription_id
        and om.user_id = auth.uid()
        and om.role in ('owner','manager')
    )
  );

-- Premium buyer (user-bound subs) — the user sees their own payments.
drop policy if exists payments_user_self_select on public.payments;
create policy payments_user_self_select on public.payments
  for select
  using (
    exists (
      select 1 from public.subscriptions s
      where s.id = payments.subscription_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists payments_admin_all on public.payments;
create policy payments_admin_all on public.payments
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ----- stripe_events_processed ----------------------------------------
-- RLS enabled with no user-context policies. Service role bypasses; everyone
-- else gets zero rows. Defense in depth — even if a future API endpoint
-- accidentally queries this table under a user JWT, no rows leak.

-- ----- founder_rate_grants --------------------------------------------

drop policy if exists fr_user_self_select on public.founder_rate_grants;
create policy fr_user_self_select on public.founder_rate_grants
  for select
  using (user_id = auth.uid());

drop policy if exists fr_admin_all on public.founder_rate_grants;
create policy fr_admin_all on public.founder_rate_grants
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- Helper: current count of held founder-rate grants.
-- The webhook handler wraps the count + insert in a transaction with
-- pg_advisory_xact_lock(<constant>) to make the "first 50" check race-safe.
-- ============================================================

create or replace function public.count_active_founder_grants()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.founder_rate_grants
  where released_at is null;
$$;
