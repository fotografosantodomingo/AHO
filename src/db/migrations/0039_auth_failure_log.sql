-- 0039_auth_failure_log.sql
--
-- Email-keyed progressive lockout for the password sign-in path. Pairs
-- the IP-keyed Cloudflare KV rate-limit (used by `aho_rate_limit` for
-- unauth API surfaces) with an email-keyed layer so a determined
-- attacker rotating IPs can't grind through a single account.
--
-- Thresholds (mirrored in src/lib/auth/lockout.ts so the pure
-- threshold-evaluator function can be unit-tested without DB):
--   - 5  failures in last 10 min  → 1-minute cooldown
--   - 10 failures in last 30 min  → 15-minute cooldown
--   - 20 failures in last 60 min  → 24-hour lockout (manual unlock)
--
-- Failures rotate naturally — older rows fall out of the windows as
-- time advances, so a normal user who fat-fingers their password 3-4
-- times then gets it right is never blocked. A successful sign-in
-- prunes the user's row history (see `prune_auth_failures` below) so
-- "old" failures from days ago don't haunt a legitimate retry.
--
-- Why a table (vs Cloudflare KV like the IP rate-limit): we need
-- range queries ("how many failures in the last 60 min") which KV
-- doesn't support cleanly without a list of pinned keys. Postgres
-- gives us indexed range scans for free. The 24h lockout row is also
-- something a platform admin can manually clear via SQL — useful when
-- the legitimate user finally calls support.
--
-- Privacy: emails are stored as citext for case-insensitive match.
-- We do NOT store passwords (obviously) or password hashes; this is
-- purely a counter. IP + UA are nullable diagnostics; for users on
-- cookieless flows we won't always have them.
--
-- RLS posture: zero direct access for anon + authenticated. All
-- writes + reads go through SECURITY DEFINER RPCs that the
-- service-role admin client (or the Edge route's service-role) calls.
-- No user-context surface should be able to enumerate sign-in
-- failures by email; that would be a username-existence oracle.

create table if not exists public.auth_failure_log (
  id uuid primary key default gen_random_uuid(),
  email citext not null,
  ip text,
  user_agent text,
  occurred_at timestamptz not null default now()
);

-- The hot query is "count(*) where email=$1 and occurred_at > now()-interval '$2'".
-- A composite (email, occurred_at) index serves all three windows.
create index if not exists idx_auth_failure_log_email_time
  on public.auth_failure_log(email, occurred_at desc);

alter table public.auth_failure_log enable row level security;

-- Platform admins can read everything (audit / debugging / "why is
-- this user locked out?" support flow). Everyone else is denied —
-- there is no user-facing surface that should query this table.
drop policy if exists auth_failure_log_admin_select on public.auth_failure_log;
create policy auth_failure_log_admin_select
  on public.auth_failure_log
  for select
  using (public.is_platform_admin());

drop policy if exists auth_failure_log_admin_all on public.auth_failure_log;
create policy auth_failure_log_admin_all
  on public.auth_failure_log
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ===== Lockout-check RPC =====
--
-- Returns the current lockout state for the given email. Pure read.
-- Intended for use BEFORE the auth attempt — if `blocked = true`, the
-- caller surfaces the cooldown message and skips the sign-in call
-- entirely (and still records a failure via record_auth_failure so a
-- determined attacker can't reset their own clock by spamming).
--
-- Thresholds are baked into the function body to keep the policy
-- tamper-evident in DB. The TS-side pure helper mirrors them; the
-- two are tested in lockout.test.ts.
create or replace function public.check_auth_lockout(p_email citext)
returns table (
  blocked boolean,
  reason text,
  retry_after timestamptz,
  failure_count_10m integer,
  failure_count_30m integer,
  failure_count_60m integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count_10m integer;
  v_count_30m integer;
  v_count_60m integer;
  v_last_at timestamptz;
begin
  -- count(*) returns bigint; cast to integer to match the OUT-table
  -- column type. Anything that overflows int4 here would mean billions
  -- of failures for one email, which the lockout-tier-3 path long ago
  -- locked out anyway.
  select count(*)::integer into v_count_10m
    from public.auth_failure_log
   where email = p_email
     and occurred_at > v_now - interval '10 minutes';

  select count(*)::integer into v_count_30m
    from public.auth_failure_log
   where email = p_email
     and occurred_at > v_now - interval '30 minutes';

  select count(*)::integer into v_count_60m
    from public.auth_failure_log
   where email = p_email
     and occurred_at > v_now - interval '60 minutes';

  select max(occurred_at) into v_last_at
    from public.auth_failure_log
   where email = p_email
     and occurred_at > v_now - interval '24 hours';

  -- Tier 3: 20+ failures in 60 min → 24h lockout from the LAST failure.
  if v_count_60m >= 20 then
    return query select
      true,
      'lockout_24h'::text,
      coalesce(v_last_at, v_now) + interval '24 hours',
      v_count_10m, v_count_30m, v_count_60m;
    return;
  end if;

  -- Tier 2: 10+ failures in 30 min → 15-min cooldown from last failure.
  if v_count_30m >= 10 then
    return query select
      true,
      'cooldown_15m'::text,
      coalesce(v_last_at, v_now) + interval '15 minutes',
      v_count_10m, v_count_30m, v_count_60m;
    return;
  end if;

  -- Tier 1: 5+ failures in 10 min → 1-min cooldown from last failure.
  if v_count_10m >= 5 then
    return query select
      true,
      'cooldown_1m'::text,
      coalesce(v_last_at, v_now) + interval '1 minute',
      v_count_10m, v_count_30m, v_count_60m;
    return;
  end if;

  return query select
    false, null::text, null::timestamptz,
    v_count_10m, v_count_30m, v_count_60m;
end;
$$;

revoke execute on function public.check_auth_lockout(citext) from public;
grant execute on function public.check_auth_lockout(citext) to anon, authenticated, service_role;

-- ===== Record-failure RPC =====
--
-- Inserts one row. Intentionally callable from anon — the sign-in
-- form is by definition pre-auth and needs to be able to log its own
-- failures. The SECURITY DEFINER posture means the caller never gets
-- direct INSERT on the table; they go through this function and only
-- with the columns we expose. No way to backdate `occurred_at` or
-- spoof another email via the RPC itself (caller passes their email,
-- which is also the column the lockout queries by — so an attacker
-- spamming a victim's email just locks the victim out, which is the
-- existing problem this layer solves, not a new one introduced by
-- exposing the RPC to anon).
create or replace function public.record_auth_failure(
  p_email citext,
  p_ip text,
  p_user_agent text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.auth_failure_log (email, ip, user_agent)
  values (p_email, nullif(p_ip, ''), nullif(p_user_agent, ''))
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.record_auth_failure(citext, text, text) from public;
grant execute on function public.record_auth_failure(citext, text, text) to anon, authenticated, service_role;

-- ===== Prune-on-success RPC =====
--
-- Called after a successful sign-in to clear the user's failure
-- history. Without this, a user who finally types their password
-- correctly would still be carrying old failures forward, and a
-- second mistake later could push them over the threshold for the
-- wrong reason.
create or replace function public.prune_auth_failures(p_email citext)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.auth_failure_log where email = p_email;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.prune_auth_failures(citext) from public;
-- Restricted to authenticated + service_role: by definition prune is
-- called AFTER a successful auth, so the caller has a session.
grant execute on function public.prune_auth_failures(citext) to authenticated, service_role;

comment on table public.auth_failure_log is
  'Email-keyed sign-in failure log. Backs the progressive lockout in '
  'src/lib/auth/lockout.ts. Direct table access is admin-only; '
  'app code uses check_auth_lockout / record_auth_failure / prune_auth_failures.';
