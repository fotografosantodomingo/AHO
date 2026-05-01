-- 0016_reviews.sql
-- Batch A1 of v1 completion: agent-targeted reviews system.
--
-- Reviews are written about AGENTS (profiles.id), not individual listings.
-- The reasoning:
--   - An agent's reputation persists across listings; listings disappear when sold
--   - Listing-level reviews invite spam ("review the property" doesn't have
--     a clean meaning); agent-level reviews map to a real interaction
--   - JSON-LD AggregateRating on RealEstateAgent is the schema.org canonical
--     surface — buyers searching for "real estate agent in {city}" land here
--
-- Verification flow (per DECISIONS.md, email-token for v1; transaction-lookup
-- waits for v1.1 transactions table):
--   1. Anyone (anon or signed-in) submits → status='pending_verification' +
--      verification_token + verification_token_expires_at (7 days). Email
--      sent to reviewer with a click-through link.
--   2. Reviewer clicks → /reviews/verify/[token] → calls SECURITY DEFINER
--      function `verify_review_token(p_token)` which validates + flips to
--      status='pending_moderation'.
--   3. Admin reviews via /admin/reviews → approves to 'published' or rejects.
--   4. On 'published', notification email sent to the target agent (route
--      layer; not a trigger — keeps email dispatch out of the DB).
--   5. Anyone can flag a published review → review_reports row → admin queue.
--
-- Field-level write protection: Postgres RLS gates rows but not columns.
-- The protect_review_fields() BEFORE UPDATE trigger enforces column-level
-- limits per role (reviewer can edit body/rating only while pending; agent
-- can set agent_reply only on published; admin can do anything). Same
-- pattern as protect_profile_admin_fields() in 0002.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),

  -- Target agent. Cascade delete because reviews are about a profile —
  -- if the profile is deleted (GDPR right-to-be-forgotten path), reviews
  -- about them go too.
  agent_id uuid not null references public.profiles(id) on delete cascade,

  -- Reviewer identity. Either a signed-in user (reviewer_user_id) or
  -- an anonymous reviewer giving email + name. Constraint enforces at
  -- least one identity path. set null on user delete so reviews stay
  -- (they were valuable to other users) but the link breaks.
  reviewer_user_id uuid references public.profiles(id) on delete set null,
  reviewer_email citext,
  reviewer_name text,

  -- Optional context: which listing the reviewer worked with the agent
  -- on. Nullable in v1; v1.1 transaction-lookup verification reads from
  -- this when a transactions table exists.
  property_id uuid references public.properties(id) on delete set null,

  -- 1–5 star scale (DECISIONS.md default). Required.
  rating int not null check (rating between 1 and 5),

  -- Body text. 50-char minimum (DECISIONS.md default), 5000-char cap to
  -- prevent abuse. char_length not length() because we deal with UTF-8.
  body text not null check (char_length(body) between 50 and 5000),

  -- Locale of the review at submission time. Locks language so
  -- verification + agent-notification emails go in the right language.
  locale text not null default 'en' check (locale in ('en', 'es')),

  -- Workflow. Order matters; status transitions are one-way except admin
  -- can move published → hidden.
  status text not null default 'pending_verification' check (status in (
    'pending_verification', 'pending_moderation', 'published', 'rejected', 'hidden'
  )),

  -- Email-token verification. 32-char hex token from the route layer.
  -- Cleared once consumed (atomic via the SECURITY DEFINER function).
  verification_token text,
  verification_token_expires_at timestamptz,
  verified_at timestamptz,

  -- Agent reply (single per review, public, optional).
  agent_reply text check (agent_reply is null or char_length(agent_reply) between 10 and 2000),
  agent_replied_at timestamptz,

  -- Moderation context.
  moderated_at timestamptz,
  moderated_by uuid references public.profiles(id) on delete set null,
  moderation_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Identity must be present in some form.
  constraint reviews_identity_present check (
    reviewer_user_id is not null
    or (reviewer_email is not null and reviewer_name is not null)
  ),

  -- Self-review prevention: agent cannot review themselves.
  constraint reviews_no_self_review check (
    reviewer_user_id is null or reviewer_user_id <> agent_id
  )
);

-- Touch updated_at via the existing trigger function from 0001_init.sql.
create trigger reviews_touch_updated_at
  before update on public.reviews
  for each row execute function public.touch_updated_at();

-- ----- review_reports — flag/report system -----

create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_user_id uuid references public.profiles(id) on delete set null,
  reporter_email citext,
  reason text not null check (reason in (
    'spam', 'fake', 'defamatory', 'inappropriate', 'duplicate', 'other'
  )),
  notes text check (notes is null or char_length(notes) <= 2000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);

-- ============================================================
-- Indexes
-- ============================================================

-- Public read path: agent profile loads recent published reviews.
create index if not exists idx_reviews_agent_published
  on public.reviews(agent_id, created_at desc)
  where status = 'published';

-- Verification token lookup. Partial index — only rows with active tokens.
create index if not exists idx_reviews_verification_token
  on public.reviews(verification_token)
  where verification_token is not null;

-- Admin moderation queue.
create index if not exists idx_reviews_moderation_queue
  on public.reviews(created_at)
  where status = 'pending_moderation';

-- Reviewer's own reviews (dashboard "my reviews" later).
create index if not exists idx_reviews_reviewer
  on public.reviews(reviewer_user_id)
  where reviewer_user_id is not null;

-- Aggregate-rating computation: count + avg by agent_id, status='published'.
-- The idx_reviews_agent_published partial index covers it.

-- Reports — admin queue.
create index if not exists idx_review_reports_open
  on public.review_reports(created_at)
  where status = 'open';

create index if not exists idx_review_reports_review
  on public.review_reports(review_id);

-- ============================================================
-- RLS — reviews
-- ============================================================

alter table public.reviews enable row level security;
alter table public.review_reports enable row level security;

-- ----- SELECT -----

-- Anyone reads PUBLISHED reviews. This is the buyer-facing surface.
drop policy if exists reviews_public_select_published on public.reviews;
create policy reviews_public_select_published on public.reviews
  for select
  to anon, authenticated
  using (status = 'published');

-- A signed-in reviewer can see their own review at any status (so they
-- can track "is my review visible yet?").
drop policy if exists reviews_reviewer_self_select on public.reviews;
create policy reviews_reviewer_self_select on public.reviews
  for select
  to authenticated
  using (reviewer_user_id = (select auth.uid()));

-- The target agent can see all reviews about themselves (drafts + pending +
-- published + hidden) so the dashboard can show them context.
drop policy if exists reviews_agent_select_own on public.reviews;
create policy reviews_agent_select_own on public.reviews
  for select
  to authenticated
  using (agent_id = (select auth.uid()));

-- Admin sees everything.
drop policy if exists reviews_admin_select on public.reviews;
create policy reviews_admin_select on public.reviews
  for select
  to authenticated
  using (public.is_platform_admin());

-- ----- INSERT -----

-- Anyone (anon + authenticated) can submit. The route layer validates
-- Turnstile + sends the verification email. The status MUST enter as
-- 'pending_verification' — direct-to-published writes are blocked.
drop policy if exists reviews_anyone_insert on public.reviews;
create policy reviews_anyone_insert on public.reviews
  for insert
  to anon, authenticated
  with check (
    status = 'pending_verification'
    -- For authenticated users, they cannot impersonate another user_id.
    and (reviewer_user_id is null or reviewer_user_id = (select auth.uid()))
  );

-- ----- UPDATE -----

-- The reviewer can edit body / rating / locale WHILE pending_verification
-- (typo correction before the verify email arrives). After verification,
-- the review is locked from reviewer edits. The protect_review_fields()
-- trigger enforces column-level scope; this policy enforces row scope.
drop policy if exists reviews_reviewer_update_pending on public.reviews;
create policy reviews_reviewer_update_pending on public.reviews
  for update
  to authenticated
  using (
    reviewer_user_id = (select auth.uid())
    and status = 'pending_verification'
  )
  with check (
    reviewer_user_id = (select auth.uid())
    and status = 'pending_verification'
  );

-- The target agent can update their reply. Column-level: only agent_reply
-- (and derived agent_replied_at) — enforced by trigger. Row scope:
-- only on their own published reviews.
drop policy if exists reviews_agent_reply on public.reviews;
create policy reviews_agent_reply on public.reviews
  for update
  to authenticated
  using (agent_id = (select auth.uid()) and status = 'published')
  with check (agent_id = (select auth.uid()) and status = 'published');

-- Admin can do anything for moderation.
drop policy if exists reviews_admin_update on public.reviews;
create policy reviews_admin_update on public.reviews
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ----- DELETE -----

-- Admin only. Reviewers cannot delete their own (would defeat moderation
-- record). Admin delete is a hard remove; soft-hide is status='hidden'.
drop policy if exists reviews_admin_delete on public.reviews;
create policy reviews_admin_delete on public.reviews
  for delete
  to authenticated
  using (public.is_platform_admin());

-- ============================================================
-- RLS — review_reports
-- ============================================================

-- Reporter can see their own report.
drop policy if exists review_reports_reporter_select on public.review_reports;
create policy review_reports_reporter_select on public.review_reports
  for select
  to authenticated
  using (reporter_user_id = (select auth.uid()));

-- Admin sees everything.
drop policy if exists review_reports_admin_select on public.review_reports;
create policy review_reports_admin_select on public.review_reports
  for select
  to authenticated
  using (public.is_platform_admin());

-- Anyone can report a published review (anon + authenticated). The route
-- layer applies Turnstile + a per-IP rate limit.
drop policy if exists review_reports_anyone_insert on public.review_reports;
create policy review_reports_anyone_insert on public.review_reports
  for insert
  to anon, authenticated
  with check (
    status = 'open'
    and (reporter_user_id is null or reporter_user_id = (select auth.uid()))
  );

-- Admin can update (review/dismiss).
drop policy if exists review_reports_admin_update on public.review_reports;
create policy review_reports_admin_update on public.review_reports
  for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Admin can delete.
drop policy if exists review_reports_admin_delete on public.review_reports;
create policy review_reports_admin_delete on public.review_reports
  for delete
  to authenticated
  using (public.is_platform_admin());

-- ============================================================
-- Triggers
-- ============================================================

-- Column-level write protection. RLS gates rows but not columns; this
-- trigger strips disallowed column changes per role. Same pattern as
-- protect_profile_admin_fields() from 0002_identity.sql.
create or replace function public.protect_review_fields()
returns trigger
language plpgsql
as $$
declare
  v_caller uuid;
  v_is_admin boolean;
begin
  v_caller := (select auth.uid());
  v_is_admin := public.is_platform_admin();

  -- Admin bypass — full edit.
  if v_is_admin then
    -- Stamp moderation fields when admin changes status.
    if new.status is distinct from old.status then
      new.moderated_at := now();
      new.moderated_by := v_caller;
    end if;
    return new;
  end if;

  -- Reviewer in pending_verification flow — body/rating/locale only.
  if old.reviewer_user_id is not distinct from v_caller
     and old.status = 'pending_verification' then
    new.id := old.id;
    new.agent_id := old.agent_id;
    new.reviewer_user_id := old.reviewer_user_id;
    new.reviewer_email := old.reviewer_email;
    new.reviewer_name := old.reviewer_name;
    new.property_id := old.property_id;
    new.status := old.status;
    new.verification_token := old.verification_token;
    new.verification_token_expires_at := old.verification_token_expires_at;
    new.verified_at := old.verified_at;
    new.agent_reply := old.agent_reply;
    new.agent_replied_at := old.agent_replied_at;
    new.moderated_at := old.moderated_at;
    new.moderated_by := old.moderated_by;
    new.moderation_notes := old.moderation_notes;
    new.created_at := old.created_at;
    return new;
  end if;

  -- Target agent — agent_reply only, on published reviews.
  if old.agent_id = v_caller and old.status = 'published' then
    new.id := old.id;
    new.agent_id := old.agent_id;
    new.reviewer_user_id := old.reviewer_user_id;
    new.reviewer_email := old.reviewer_email;
    new.reviewer_name := old.reviewer_name;
    new.property_id := old.property_id;
    new.rating := old.rating;
    new.body := old.body;
    new.locale := old.locale;
    new.status := old.status;
    new.verification_token := old.verification_token;
    new.verification_token_expires_at := old.verification_token_expires_at;
    new.verified_at := old.verified_at;
    new.moderated_at := old.moderated_at;
    new.moderated_by := old.moderated_by;
    new.moderation_notes := old.moderation_notes;
    new.created_at := old.created_at;
    -- Stamp agent_replied_at when reply text changes (or first set).
    if new.agent_reply is distinct from old.agent_reply and new.agent_reply is not null then
      new.agent_replied_at := now();
    end if;
    return new;
  end if;

  -- Defense-in-depth: RLS should have blocked this UPDATE. If we reach
  -- here, something has gone wrong — refuse the update.
  raise exception 'Not authorized to update this review (caller=%, status=%)', v_caller, old.status;
end;
$$;

drop trigger if exists trg_protect_review_fields on public.reviews;
create trigger trg_protect_review_fields
  before update on public.reviews
  for each row
  execute function public.protect_review_fields();

-- ============================================================
-- SECURITY DEFINER: verify_review_token
-- ============================================================
-- The verification link in the email lands on a public page, which calls
-- this function. The page may be hit by an anon visitor (the reviewer
-- might not be signed in, especially for anonymous reviews). Using a
-- SECURITY DEFINER function keeps the route layer free of service-role
-- exposure: the function does the auth check (token validity) and the
-- atomic flip. Returns the review id on success or an error code.

create or replace function public.verify_review_token(p_token text)
returns table (review_id uuid, success boolean, error_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review_id uuid;
begin
  if p_token is null or char_length(p_token) <> 32 then
    return query select null::uuid, false, 'invalid_token_format'::text;
    return;
  end if;

  -- Atomic find + lock. Use FOR UPDATE so concurrent verify calls don't
  -- both succeed (both would see the row, both would return success).
  select id into v_review_id
  from public.reviews
  where verification_token = p_token
    and verification_token_expires_at > now()
    and status = 'pending_verification'
  limit 1
  for update;

  if v_review_id is null then
    return query select null::uuid, false, 'invalid_or_expired'::text;
    return;
  end if;

  update public.reviews
  set
    status = 'pending_moderation',
    verified_at = now(),
    verification_token = null,
    verification_token_expires_at = null
  where id = v_review_id;

  return query select v_review_id, true, null::text;
end;
$$;

grant execute on function public.verify_review_token(text) to anon, authenticated;

-- ============================================================
-- Helper: aggregate_rating_for_agent (server-side AggregateRating shape)
-- ============================================================
-- Returns count + avg for a given agent's published reviews. Used by the
-- agent profile page to render the AggregateRating JSON-LD (omit when
-- count = 0 — invalid schema otherwise).

create or replace function public.aggregate_rating_for_agent(p_agent_id uuid)
returns table (review_count bigint, avg_rating numeric)
language sql
stable
as $$
  select count(*)::bigint, round(avg(rating)::numeric, 2)
  from public.reviews
  where agent_id = p_agent_id and status = 'published';
$$;

grant execute on function public.aggregate_rating_for_agent(uuid) to anon, authenticated;
