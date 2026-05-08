-- 0037_listing_performance.sql
--
-- Sprint 3 — Performance dashboard data plumbing.
--
-- Stores per-listing × per-platform × per-post snapshots of social
-- performance: reach / impressions / clicks / leads / CPL. The
-- dashboard at /[locale]/dashboard/analytics/[id] reads this table
-- via a user-context Supabase client; aggregation runs in JS and the
-- "Social performance" tab renders correctly empty when no rows
-- exist (the state the table is in TODAY — Meta App Review hasn't
-- approved live publishing, FB Lead Ads webhook isn't wired).
--
-- Snapshot semantics: one row per (listing × platform × post_external_id
-- × snapshot date — implicit via captured_at::date). A listing posted
-- to FB + IG = 2 rows on the day of posting; subsequent daily snapshots
-- add 2 more rows per day reflecting the cumulative reach / impressions
-- / clicks / leads at that point in time. The dashboard renders both:
--   - the latest snapshot per (listing, platform, post_external_id) for
--     "current totals"
--   - the time series for the 30-day reach sparkline
--
-- Future writers (none of which exist today):
--   - Meta Insights API cron (Cloudflare Worker on a daily schedule)
--     polls each connected page/IG account for posts AHO created and
--     upserts a fresh snapshot row.
--   - FB Lead Ads webhook (POST /api/webhooks/meta/leads) increments
--     the `leads` counter on the latest row for the originating post,
--     and inserts a parallel row in `leads` (existing table) tagged
--     with source=fb_lead_ad for the inbox view.
--   - LinkedIn Marketing API cron (separate review process, Sprint 3+).
--
-- All writes are service-role; no user-context INSERT/UPDATE policies.
-- Agents read rows for their own org's listings via the SELECT policy
-- below + admins read all (super-admin escape hatch for support).
--
-- CPL: stored as integer cents in `cpl_cents bigint` per CLAUDE.md
-- "Money is stored as integer cents in `bigint` where necessary."
-- Currency is per-row because a single agent might pay for ads in
-- different currencies across markets (e.g. DOP for DR, EUR for ES).

create table if not exists public.listing_post_metrics (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.properties(id) on delete cascade,
  -- Same vocabulary as ad_platform_tokens.platform — let the FK
  -- between (user, platform, account) on tokens line up cleanly with
  -- (listing, platform, post) here. Pinterest/TikTok included for
  -- forward-compat; today only meta-family platforms (fb / ig)
  -- + linkedin will populate.
  platform text not null check (platform in (
    'facebook',
    'instagram',
    'linkedin',
    'tiktok',
    'pinterest'
  )),
  -- When the post itself went live on the platform. Distinct from
  -- captured_at (when AHO snapshotted the metrics). For backfilled
  -- rows from a webhook, posted_at can predate captured_at by hours
  -- or days.
  posted_at timestamptz not null,
  -- The platform's stable id for the post. FB graph: `{page_id}_{post_id}`;
  -- IG graph: media id; LinkedIn: urn:li:share:....
  -- Required so daily snapshots can be deduped per-post.
  post_external_id text not null,
  -- Cumulative-to-date counters at the moment of snapshot.
  reach integer not null default 0 check (reach >= 0),
  impressions integer not null default 0 check (impressions >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  leads integer not null default 0 check (leads >= 0),
  -- Cost per lead at this snapshot, integer cents. NULL when no paid
  -- spend is associated with the post (organic reach only). Currency
  -- is held alongside per-row.
  cpl_cents bigint check (cpl_cents is null or cpl_cents >= 0),
  currency char(3) not null default 'USD',
  -- When AHO captured this snapshot. Daily cron writes one row per
  -- (listing, platform, post_external_id) per day; the (listing,
  -- platform, post_external_id, captured_at::date) uniqueness is
  -- enforced by the partial unique index below — using the date
  -- truncation lets the same row be re-upserted within a day if
  -- the cron retries.
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Dashboard query: "give me the metric rows for THIS listing, ordered
-- by platform + posted_at desc". This index covers it directly.
create index if not exists idx_listing_post_metrics_listing_platform_posted
  on public.listing_post_metrics(listing_id, platform, posted_at desc);

-- Sparkline query: "give me reach over the last 30 days for THIS listing".
-- Filters by listing_id + captured_at >= now() - 30d.
create index if not exists idx_listing_post_metrics_listing_captured
  on public.listing_post_metrics(listing_id, captured_at desc);

-- Snapshot dedup: at most one row per (listing, platform,
-- post_external_id, captured-day). Date-truncation in the unique index
-- expression lets the cron job retry within the same day without
-- creating duplicate rows; the next day's run inserts a new row for
-- the time-series.
create unique index if not exists ux_listing_post_metrics_daily
  on public.listing_post_metrics (
    listing_id,
    platform,
    post_external_id,
    (date_trunc('day', captured_at))
  );

create trigger listing_post_metrics_updated_at
  before update on public.listing_post_metrics
  for each row execute function public.touch_updated_at();

alter table public.listing_post_metrics enable row level security;

-- ===== SELECT =====
-- Org members read metrics for their own org's listings. We join to
-- properties and use the same `organization_members` membership check
-- as `property_events_org_select` (migration 0027). Service-role
-- bypasses RLS for the writer cron.
create policy listing_post_metrics_org_select
  on public.listing_post_metrics for select
  to authenticated
  using (
    listing_id in (
      select p.id
      from public.properties p
      where p.org_id in (
        select om.org_id
        from public.organization_members om
        where om.user_id = (select auth.uid())
      )
    )
  );

-- Admin reads all (support / cross-org analytics).
create policy listing_post_metrics_admin_select
  on public.listing_post_metrics for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

-- No INSERT / UPDATE / DELETE policies. Writes happen via service-role
-- through the future cron + webhook. There is no "agent edits a
-- metric" user flow.

comment on table public.listing_post_metrics is
  'Per-listing × per-platform × per-post snapshots of social performance (reach / impressions / clicks / leads / CPL). Populated by Meta Insights API cron + FB Lead Ads webhook (Sprint 3); reads gated to the listing''s org via RLS. See docs/CONTENT_HUB_VISION.md Sprint 3.';
