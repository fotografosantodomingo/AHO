-- 0074_private_owner_listings.sql
--
-- Adds the private-owner $5 one-time-listing product per
-- docs/SELL_FUNNEL_PLAN.md. Three concerns:
--
--   1. profiles.accountType  — disambiguates private-owner accounts
--      from real-estate agents at signup so the dashboard nav, RLS
--      policies, and the AHO Assistant prompt can branch on the
--      user's intent.
--   2. properties columns —
--        expires_at      60-day TTL for private listings (NULL for
--                        agent-subscription listings which stay
--                        published as long as the subscription is
--                        active)
--        published_via   discriminator between the two flows. Same
--                        public render but different gating (no AI
--                        chat widget on private listings; contact
--                        form only).
--   3. listing_purchases  — Stripe one-time-payment fact table.
--      One row per $5 charge; linked to a properties.id once the
--      buyer completes the simplified create-listing form. Allows
--      the day-55 renewal email to pivot ("you paid but haven't
--      published yet") for orphaned purchases.
--
-- RLS + REVOKE patterns mirror migration 0065 hardening: enable
-- RLS, add the minimal SELECT policy for the right audience, then
-- explicitly REVOKE write grants from anon + authenticated so the
-- API layer is the only mutation surface (CLAUDE.md hard rule #4).

-- ─── profiles.accountType ──────────────────────────────────────────

alter table public.profiles
  add column if not exists account_type text not null default 'private_owner'
  check (account_type in ('private_owner', 'agent', 'agency'));

create index if not exists idx_profiles_account_type on public.profiles(account_type)
  where account_type <> 'private_owner';
-- Partial index — private_owner will become the most common type;
-- queries that filter on accountType usually look for the minority
-- (agent / agency dashboards). Skipping the dominant value keeps
-- the index small.

comment on column public.profiles.account_type is
  'Disambiguates private-owner accounts (one-time $5 listing) from real-estate agents/agencies (subscription). Set at signup or auto-set on first $5 purchase. The dashboard nav, RLS policies, and the AHO Assistant system prompt all branch on this value.';

-- ─── properties.expires_at + published_via ─────────────────────────

alter table public.properties
  add column if not exists expires_at timestamptz,
  add column if not exists published_via text not null default 'agent_subscription'
  check (published_via in ('agent_subscription', 'private_purchase'));

create index if not exists idx_properties_expires_at on public.properties(expires_at)
  where expires_at is not null;
-- Partial index — only private-purchase rows have a non-null
-- expires_at, and only those need the daily-expiry cron scan.

comment on column public.properties.expires_at is
  '60-day TTL for private-owner listings (NULL for agent-subscription listings). The daily expiry cron (workers/listing-expiry/) flips status=''active'' → ''expired'' once now() > expires_at.';

comment on column public.properties.published_via is
  'Discriminator: agent_subscription means the listing is owned by a Pro/Plus/Agent-tier subscriber and stays live as long as they pay; private_purchase means a one-time $5 listing with a 60-day TTL via expires_at.';

-- ─── listing_purchases ─────────────────────────────────────────────

create table public.listing_purchases (
  id uuid primary key default gen_random_uuid(),
  -- Nullable so a purchase row can exist BEFORE the buyer creates
  -- the listing (the 'paid but unpublished' state the day-55 cron
  -- targets with the 'finish your listing' email).
  property_id uuid references public.properties(id) on delete set null,
  buyer_user_id uuid not null references public.profiles(id) on delete restrict,
  stripe_session_id text unique not null,
  -- The PaymentIntent id from the completed Checkout Session. Stored
  -- separately because `charge.refunded` events carry the PI id (NOT
  -- the session id) — we need this column to look up which purchase
  -- to mark refunded. Unique-ish in practice (one PI per session) but
  -- not constrained UNIQUE because Stripe theoretically allows
  -- multiple charges per PI in some flows.
  stripe_payment_intent_id text,
  -- The webhook's event id so we can dedup on Stripe retries.
  -- supabase-js dedup happens at the unique index level; this is
  -- additional bookkeeping for observability.
  stripe_event_id text,
  amount_cents integer not null check (amount_cents > 0),
  -- ISO-4217 (USD / EUR / etc) — Stripe will normalize the
  -- buyer-facing display via Stripe Tax; we store what Stripe
  -- charged.
  currency char(3) not null,
  paid_at timestamptz not null,
  -- paid_at + 60 days, set at row creation. NOT updated on renewal;
  -- a renewal creates a NEW row with its own expires_at, and the
  -- linked property's `expires_at` is bumped to whichever is later.
  expires_at timestamptz not null,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_listing_purchases_buyer on public.listing_purchases(buyer_user_id);
create index idx_listing_purchases_property on public.listing_purchases(property_id)
  where property_id is not null;
create index idx_listing_purchases_expires on public.listing_purchases(expires_at);
-- The day-55 renewal cron scans this index for `expires_at between now() AND now()+5 days`.
create index idx_listing_purchases_payment_intent
  on public.listing_purchases(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
-- Refund handler scans by PaymentIntent id (charge.refunded event payload
-- carries the PI, not the session). Partial index — only rows with a PI
-- value need to be searchable this way.

alter table public.listing_purchases enable row level security;

-- Buyers can read their own purchase history (for the billing
-- portal / receipt page). Service-role writes; never written from
-- the user-context client.
create policy "buyer_reads_own_purchases" on public.listing_purchases
  for select to authenticated
  using (buyer_user_id = auth.uid());

revoke insert, update, delete on public.listing_purchases from anon, authenticated;

comment on table public.listing_purchases is
  'Stripe one-time-payment fact table for the $5 private-owner listing product. One row per charge. Linked to a properties row once the buyer publishes; nullable property_id covers the "paid but unpublished" state that the day-55 renewal cron emails the buyer about.';

-- ─── Expiry-cron idempotency markers ──────────────────────────────
-- Three nullable timestamps the daily listing-expiry cron uses as
-- once-and-only-once flags. Each is initially NULL; the cron checks
-- `IS NULL` before sending the corresponding email and stamps
-- `now()` after a successful send. The column IS the dedup key —
-- no separate "emails_sent" table needed. See
-- `src/app/api/cron/listing-expiry/route.ts` +
-- `workers/listing-expiry/` (cron `0 4 * * *` UTC daily).
--
-- Why three columns instead of one + a `kind` enum: each of the
-- three flows (renewal reminder, expired, finish-your-listing
-- nudge) is independent — a buyer might receive the renewal
-- reminder at day 55 AND the expired email at day 60; both flags
-- need to track separately. Three columns let the cron's IS NULL
-- checks index cleanly with no row mutation between sends.
alter table public.listing_purchases
  add column if not exists renewal_reminder_sent_at timestamptz,
  add column if not exists expired_email_sent_at timestamptz,
  add column if not exists unpublished_reminder_sent_at timestamptz;

comment on column public.listing_purchases.renewal_reminder_sent_at is
  'Set by the daily expiry cron after the "expires in 5 days — renew for $5" email is sent. NULL means not sent; the cron uses IS NULL as its idempotency guard so repeated runs do not re-send.';
comment on column public.listing_purchases.expired_email_sent_at is
  'Set by the daily expiry cron after the "your AHO listing has expired" email is sent (day 60). NULL means not sent. The cron sets this in the same pass it flips `properties.status` from active to expired.';
comment on column public.listing_purchases.unpublished_reminder_sent_at is
  'Set by the daily expiry cron after the "finish your listing — you have already paid" nudge is sent. Targets orphaned purchase rows where property_id is still NULL 5+ days post-purchase. NULL means not sent.';
