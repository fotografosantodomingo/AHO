-- 0018_admin_bootstrap.sql
-- Two-part fix for the "Supabase SQL Editor UPDATE silently reverts
-- is_admin/admin_role" issue diagnosed 2026-05-01.
--
-- Part 1: Loosen `protect_profile_admin_fields()` so direct DB access
-- (no JWT context) is allowed to write the admin fields. This is what
-- migrations, the SQL Editor, and the postgres superuser all see.
-- Anyone with direct DB access already has full DB privilege; the
-- trigger's actual job is preventing AUTHENTICATED user-context
-- UPDATEs from elevating their own privileges. That posture is
-- preserved (any non-null JWT that isn't service_role still gets the
-- revert).
--
-- Part 2: Idempotent bootstrap for the platform's first admin. Sets
-- info@advertisehomes.online to is_admin=true if a profile row exists
-- for that email. Matches case-insensitively + trim-tolerant. No-op
-- when the row doesn't exist (signup hasn't happened yet) — re-running
-- the migration after signup completes the bootstrap.
--
-- Why bake this into a migration vs. document a SQL snippet: the
-- snippet has been confusing in practice because the trigger was
-- silently reverting it. Putting the bootstrap into a migration that
-- runs AFTER the trigger fix removes the human-readable-instructions
-- failure mode.

-- ============================================================
-- Part 1: trigger function update
-- ============================================================

create or replace function public.protect_profile_admin_fields()
returns trigger
language plpgsql
as $$
begin
  -- Permitted contexts (do NOT revert):
  --   1. JWT role is 'service_role' — our admin Supabase client; the
  --      app-driven promotion/demotion path via setUserAdmin().
  --   2. JWT is NULL — direct DB access (SQL Editor, migrations,
  --      scheduled jobs, postgres superuser). Necessary for first-
  --      admin bootstrap and platform recovery.
  --
  -- Blocked contexts (revert is_admin / admin_role to OLD values):
  --   - Authenticated user JWT with role='authenticated'. This is the
  --     attack surface — a regular user trying to UPDATE their own
  --     profile to set is_admin=true. The trigger's job.
  if (auth.jwt() ->> 'role') = 'service_role' or auth.jwt() is null then
    return new;
  end if;
  new.is_admin := old.is_admin;
  new.admin_role := old.admin_role;
  return new;
end;
$$;

-- ============================================================
-- Part 2: idempotent first-admin bootstrap
-- ============================================================
--
-- Match on lower-trim'd email (citext is already case-insensitive but
-- trim guards against accidental whitespace in the stored value).
-- Updates only when the row exists; safe to re-run as new admins are
-- promoted via setUserAdmin (which uses the service-role client).

update public.profiles
set is_admin = true,
    admin_role = 'super_admin'
where lower(trim(email::text)) = 'info@advertisehomes.online'
  and (is_admin is distinct from true or admin_role is distinct from 'super_admin');
