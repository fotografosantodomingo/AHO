-- 0052_social_posts.sql
-- Phase B of docs/SOCIAL_AUTOMATION_PLAN.md — audit + idempotency layer
-- for the one-click social-publish feature ($99 Pro Automation).
--
-- Two tables:
--   public.social_posts          — one row per "Share to my socials" click.
--                                  Records who/what/when at the listing level.
--   public.social_post_attempts  — one row per (social_post × platform target).
--                                  The actual platform-side outcome lives here,
--                                  with idempotency anchored on
--                                  unique(social_post_id, external_account_id).
--
-- RLS: org members SELECT rows for listings in their own org. Service-role
-- (the publish-engine route + future workers) does all writes; there is no
-- user-context INSERT / UPDATE / DELETE policy by design. Frontend never
-- decides what a user can do (CLAUDE.md hard rule #4).
--
-- Relationship to other tables:
--   social_post_attempts.external_account_id matches the value stored on
--   ad_platform_tokens.external_account_id ('page:{fb-page-id}' or
--   'ig:{ig-business-id}' or just '{user-id}' for the user-level meta token
--   or 'urn:li:organization:{id}' for LinkedIn).
--   This is NOT a FK because (a) tokens can be revoked while attempts
--   persist for audit, and (b) the LinkedIn URN format doesn't share a
--   keyspace with FB/IG IDs.
--
-- Distinct from listing_post_metrics (migration 0038):
--   listing_post_metrics = daily SNAPSHOTS of engagement (reach, leads, CPL)
--   social_post_attempts = one-time EVENTS of "we tried to publish, here's
--                          what happened". Different cardinality + retention.

-- ============================================================
-- social_posts
-- ============================================================

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Snapshot of which platforms the agent asked us to publish to at
  -- click-time. Source of truth for "what happened" is the attempts
  -- table; this array is the request, not the outcome.
  requested_platforms text[] not null check (array_length(requested_platforms, 1) >= 1),
  created_at timestamptz not null default now()
);

create index if not exists idx_social_posts_property
  on public.social_posts(property_id, created_at desc);
create index if not exists idx_social_posts_org
  on public.social_posts(org_id, created_at desc);

alter table public.social_posts enable row level security;

drop policy if exists social_posts_org_select on public.social_posts;
create policy social_posts_org_select on public.social_posts
  for select
  to authenticated
  using (
    org_id in (
      select om.org_id
      from public.organization_members om
      where om.user_id = (select auth.uid())
    )
  );

drop policy if exists social_posts_admin_all on public.social_posts;
create policy social_posts_admin_all on public.social_posts
  for all
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- social_post_attempts
-- ============================================================

create table if not exists public.social_post_attempts (
  id uuid primary key default gen_random_uuid(),
  social_post_id uuid not null references public.social_posts(id) on delete cascade,
  -- Same vocabulary as ad_platform_tokens.platform + listing_post_metrics.
  -- Pinterest/TikTok included for forward-compat; v1 uses fb / ig / linkedin only.
  platform text not null check (platform in (
    'facebook', 'instagram', 'linkedin', 'tiktok', 'pinterest'
  )),
  -- Matches ad_platform_tokens.external_account_id format:
  --   'page:{fb-page-id}'    for Facebook Pages
  --   'ig:{ig-business-id}'  for Instagram Business
  --   '{fb-user-id}'         for the user-level Meta token (rarely posted to)
  --   'urn:li:person:{id}'   for LinkedIn member share
  --   'urn:li:organization:{id}' for LinkedIn org share
  external_account_id text not null,
  status text not null default 'queued' check (status in (
    'queued',     -- inserted, publish call not yet started
    'posting',    -- publish call in flight (used if we move to async later)
    'succeeded',  -- platform returned 2xx, external_post_id captured
    'failed',     -- platform returned non-2xx OR network error
    'skipped'     -- token revoked / missing required scope / dry-run mode
  )),
  -- The platform's stable id for the post once published. FB graph
  -- returns `{page_id}_{post_id}`; IG returns the media id; LinkedIn
  -- returns the share URN. Used to dedupe + to deep-link from the UI.
  external_post_id text,
  -- Direct URL to the post, when the platform exposes one.
  -- (Not all platforms do — IG Business publish returns media id only;
  -- the URL must be constructed.)
  external_post_url text,
  -- Categorized error code from the publish primitive when status='failed'.
  -- Examples: 'token_invalid', 'permission_denied', 'rate_limited',
  -- 'image_required', 'image_too_large', 'network_timeout', 'unknown'.
  error_code text,
  -- Human-readable error message (the platform's own response body or
  -- a translated description). Rendered in the UI's failure panel.
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Idempotency: at most one attempt row per (post, account). Re-running
  -- the publish for a failed attempt UPDATEs the existing row rather than
  -- inserting a second one; a successful re-run is a no-op (the unique
  -- constraint + ON CONFLICT path in the route handler keeps it safe).
  constraint social_post_attempts_unique_target
    unique (social_post_id, external_account_id)
);

create index if not exists idx_social_post_attempts_post
  on public.social_post_attempts(social_post_id);

-- Lookup pattern for "show this listing's recent posts grouped by platform":
-- join from social_posts → social_post_attempts on social_post_id.
-- Also: future analytics "how many times have we published to this page?"
create index if not exists idx_social_post_attempts_platform_account
  on public.social_post_attempts(platform, external_account_id, started_at desc);

create trigger social_post_attempts_touch_updated_at
  before update on public.social_post_attempts
  for each row execute function public.touch_updated_at();

alter table public.social_post_attempts enable row level security;

drop policy if exists social_post_attempts_org_select on public.social_post_attempts;
create policy social_post_attempts_org_select on public.social_post_attempts
  for select
  to authenticated
  using (
    social_post_id in (
      select sp.id
      from public.social_posts sp
      where sp.org_id in (
        select om.org_id
        from public.organization_members om
        where om.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists social_post_attempts_admin_all on public.social_post_attempts;
create policy social_post_attempts_admin_all on public.social_post_attempts
  for all
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No INSERT / UPDATE / DELETE policies on either table. All writes happen
-- through the publish-engine route (Phase E) via createAdminClient() →
-- service_role, which bypasses RLS by design.

comment on table public.social_posts is
  'One row per "Share to my socials" click. Audit + idempotency anchor for the one-click social-publish feature ($99 Pro Automation). See docs/SOCIAL_AUTOMATION_PLAN.md Phase B.';
comment on table public.social_post_attempts is
  'One row per (social_post × platform account). Records the actual platform-side outcome — succeeded with external_post_id, failed with error_code, etc. Idempotent on (social_post_id, external_account_id). See docs/SOCIAL_AUTOMATION_PLAN.md Phase B.';
