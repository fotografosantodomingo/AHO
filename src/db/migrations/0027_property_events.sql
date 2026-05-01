-- 0027_property_events.sql
-- feat/property-analytics — append-only event log for property
-- engagement (views, contact-button clicks, lead submissions, favorites,
-- share clicks). Powers the agent dashboard's performance widgets +
-- the future promoted-listings ROI signal + (eventually) per-listing
-- "X people viewed this in 24h" surfaces.
--
-- Distinct from `property_recent_views` (migration 0025):
--   - recent_views is per-visitor (UPSERT, last-seen wins) for the
--     "Recently viewed" rail.
--   - property_events is APPEND-ONLY for analytics aggregation.
--
-- Identity model mirrors recent_views — user_id when authed,
-- anonymous_id from the aho_anon_id cookie when not. Either or both
-- can be null in edge cases (e.g. a system-fired lead_form_submit from
-- a fresh-cookie-less anon visitor).
--
-- Denormalized org_id: dashboard aggregates run per-org ("views in
-- last 30 days for THIS agent's listings"). Joining
-- property_events → properties → organizations is doable, but the
-- RLS expression is cleaner with org_id directly on the row, and
-- queries hit the org-keyed indexes without a join.
--
-- Cascade behavior:
--   - Property deleted → events cascade (events about a deleted
--     listing have no analytic value)
--   - Org deleted → events cascade (rare — properties.org_id is
--     ON DELETE RESTRICT, so org delete is gated on property deletion)
--   - User deleted → user_id SET NULL (anonymized; aggregate analytic
--     value preserved)

create table if not exists public.property_events (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  anonymous_id uuid,
  event_type text not null check (event_type in (
    'property_view',
    'image_gallery_open',
    'whatsapp_click',
    'phone_click',
    'email_click',
    'lead_form_submit',
    'favorite_add',
    'share_click'
  )),
  -- Free-form short tag: where the visitor came from. E.g. 'search',
  -- 'home', 'agent', 'similar', 'page' (direct), 'recent'. Used for
  -- "which surface drives the most engagement" cuts.
  source text,
  -- Free-form jsonb. Examples: { contact_method: 'whatsapp' } on a
  -- lead_form_submit; { referrer_listing_id: '...' } on a property_view
  -- from the similar-homes carousel.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Read indexes: every dashboard query is "for property X" or "for org X"
-- over a recent time window, optionally filtered by event_type.
create index if not exists idx_property_events_property_time
  on public.property_events(property_id, created_at desc);

create index if not exists idx_property_events_org_time
  on public.property_events(org_id, created_at desc);

create index if not exists idx_property_events_org_type_time
  on public.property_events(org_id, event_type, created_at desc);

create index if not exists idx_property_events_property_type_time
  on public.property_events(property_id, event_type, created_at desc);

-- Per-visitor recall (for future "your activity" surfaces).
create index if not exists idx_property_events_user_time
  on public.property_events(user_id, created_at desc)
  where user_id is not null;

create index if not exists idx_property_events_anon_time
  on public.property_events(anonymous_id, created_at desc)
  where anonymous_id is not null;

alter table public.property_events enable row level security;

-- SELECT: agent (org member) reads events for their own org's
-- properties. Joins via organization_members on the visitor's
-- own membership rows.
create policy property_events_org_select
  on public.property_events for select
  to authenticated
  using (
    org_id in (
      select om.org_id
      from public.organization_members om
      where om.user_id = (select auth.uid())
    )
  );

-- SELECT: admin reads all (moderation + cross-org analytics).
create policy property_events_admin_select
  on public.property_events for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_admin = true
    )
  );

-- No INSERT / UPDATE / DELETE policies. Writes are service-role only,
-- coming through the API routes (POST /api/properties/[id]/event +
-- the existing /view, /leads, /favorite routes which fan into events
-- server-side). Append-only — there's no edit-an-event flow.
