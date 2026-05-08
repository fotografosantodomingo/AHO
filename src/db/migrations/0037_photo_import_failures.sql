-- 0037_photo_import_failures.sql
--
-- Dead-letter table for the server-side photo-import flow
-- (POST /api/properties/:id/import-photos, shipped in 92cc6ef).
--
-- Why this exists: the import endpoint fetches each remote URL, and
-- transient failures (CDN 503, network blip, brief timeout) used to drop
-- the photo permanently — the agent would have to re-upload by hand and
-- often wouldn't even know which URLs failed. Migration 0037 + the route
-- changes in the same PR add (a) bounded in-call retry and (b) this
-- dead-letter table so the agent can see + retry exhausted failures from
-- the listing edit page later, and a future batched cron can re-attempt
-- without manual intervention.
--
-- Schema:
--   - One row per (property_id, source_url) — re-tries upsert and bump
--     the attempts counter rather than spam-inserting duplicates.
--   - error_code is the same machine-readable string the route returns
--     (`fetch_503`, `timeout`, `r2_put_failed`, etc.) — see the
--     `explainErrorCode` helper in components/listings/photo-import-banner.tsx
--     for the human-readable mapping. Latest error wins on upsert.
--   - resolved_at: set when the agent retries successfully OR clicks
--     Dismiss in the failures UI. Unresolved rows are what the UI surfaces;
--     resolved rows are kept for audit and could feed a "previously failed"
--     diagnostic if we ever need it.
--
-- RLS: mirrors property_images. Org members of the listing's org can
-- read + write. Public/anon never see this table — failures contain
-- source URLs that may identify portal scrapes.

create table if not exists public.photo_import_failures (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source_url text not null,
  error_code text not null,
  attempts integer not null default 1 check (attempts >= 1),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint photo_import_failures_unique_per_property
    unique (property_id, source_url)
);

-- "Show me unresolved failures for this listing" — the UI's primary
-- query. Partial index keeps the unresolved set small even after the
-- table accumulates years of resolved history.
create index if not exists idx_photo_import_failures_unresolved
  on public.photo_import_failures(property_id)
  where resolved_at is null;

-- updated_at maintenance — uses the same trigger function as the rest
-- of the schema (defined in 0001_init.sql).
drop trigger if exists photo_import_failures_updated_at
  on public.photo_import_failures;
create trigger photo_import_failures_updated_at
  before update on public.photo_import_failures
  for each row execute function public.touch_updated_at();

alter table public.photo_import_failures enable row level security;

-- ===== RLS policies (mirror property_images org-scoped policies) =====

-- SELECT — org members of the listing's org can read failures for that
-- listing. No public-facing policy: failure rows aren't useful to the
-- buyer side and may leak portal source URLs we'd rather not expose.
drop policy if exists photo_import_failures_org_member_select
  on public.photo_import_failures;
create policy photo_import_failures_org_member_select
  on public.photo_import_failures
  for select
  using (
    exists (
      select 1 from public.properties p
      join public.organization_members om on om.org_id = p.org_id
      where p.id = photo_import_failures.property_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists photo_import_failures_admin_all
  on public.photo_import_failures;
create policy photo_import_failures_admin_all
  on public.photo_import_failures
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- INSERT / UPDATE / DELETE — same agent+ role gate as property_images.
-- The route's session-context client uses these on the upsert path
-- (via the security-definer RPCs below); direct inserts also work for
-- admin / future tooling.

drop policy if exists photo_import_failures_org_insert
  on public.photo_import_failures;
create policy photo_import_failures_org_insert
  on public.photo_import_failures
  for insert
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  );

drop policy if exists photo_import_failures_org_update
  on public.photo_import_failures;
create policy photo_import_failures_org_update
  on public.photo_import_failures
  for update
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  );

drop policy if exists photo_import_failures_org_delete
  on public.photo_import_failures;
create policy photo_import_failures_org_delete
  on public.photo_import_failures
  for delete
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.get_user_org_role(p.org_id) in ('owner','manager','agent')
    )
  );

-- ===== Helper RPCs =====
--
-- These centralize the upsert-on-conflict + attempt-counter math the
-- import-photos route needs on every failure. Keeping them in SQL
-- means the route doesn't have to read-modify-write across two round
-- trips, and they remain RLS-scoped (SECURITY INVOKER) so the same
-- org-member rules apply.
--
-- record_photo_import_failure: insert-or-update a failure row. On
-- conflict, increments attempts, refreshes last_failed_at + error_code,
-- and clears resolved_at (a previously-resolved URL that's failing
-- again is unresolved again).
create or replace function public.record_photo_import_failure(
  p_property_id uuid,
  p_source_url text,
  p_error_code text,
  p_attempts integer
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.photo_import_failures (
    property_id, source_url, error_code, attempts,
    first_failed_at, last_failed_at, resolved_at
  ) values (
    p_property_id, p_source_url, p_error_code, greatest(p_attempts, 1),
    now(), now(), null
  )
  on conflict (property_id, source_url) do update
    set error_code = excluded.error_code,
        attempts = public.photo_import_failures.attempts + greatest(p_attempts, 1),
        last_failed_at = now(),
        resolved_at = null,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- resolve_photo_import_failure: mark the row resolved (no-op if none
-- exists). Used by the success path of a retry and by the Dismiss
-- action in the UI.
create or replace function public.resolve_photo_import_failure(
  p_property_id uuid,
  p_source_url text
) returns void
language sql
security invoker
set search_path = public
as $$
  update public.photo_import_failures
     set resolved_at = now(),
         updated_at = now()
   where property_id = p_property_id
     and source_url = p_source_url
     and resolved_at is null;
$$;

-- Both RPCs run as the caller (security invoker) so they're gated by
-- the same RLS policies above. Granting to authenticated is enough —
-- anon can't reach them because the underlying RLS will reject anyway,
-- but no need to expose them.
revoke execute on function public.record_photo_import_failure(uuid, text, text, integer) from public;
grant execute on function public.record_photo_import_failure(uuid, text, text, integer) to authenticated;

revoke execute on function public.resolve_photo_import_failure(uuid, text) from public;
grant execute on function public.resolve_photo_import_failure(uuid, text) to authenticated;

comment on table public.photo_import_failures is
  'Dead-letter rows for POST /api/properties/:id/import-photos. One row per (property_id, source_url); attempts bump on every failure. resolved_at is set on retry-success or user dismiss. RLS mirrors property_images.';
