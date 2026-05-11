-- 0046_auth_trusted_devices.sql
-- Per-user "remembered device" registry for the post-Turnstile sign-in
-- flow. When a user signs in from a new browser (no cookie) OR from a
-- different IP than last time on the same browser, we challenge them
-- with an emailed 6-digit code instead of a visible CAPTCHA. Verified
-- devices land here; subsequent sign-ins from that browser/IP combo
-- skip straight to the session.
--
-- We never store the cookie value itself — only sha256(token). On every
-- sign-in we hash the incoming cookie and look it up. Lost cookie value
-- = lost device row, no way to "recover" it; the user just goes through
-- another OTP cycle.
--
-- Cookie TTL is 90 days (PO directive 2026-05-10), enforced both by
-- the cookie's own Max-Age and by the `expires_at` column. A single
-- nightly cron (or on-write housekeeping) prunes expired rows; until
-- then RLS still hides them since `expires_at < now()` is filtered in
-- the lookup.
--
-- IP-change detection (PO chose the strict variant): compare the
-- request's `cf-connecting-ip` against `last_ip`. Mismatch → re-OTP,
-- update `last_ip` on success. Same row stays valid; user doesn't lose
-- their device record. UX cost: mobile network switches will trigger
-- OTP frequently; can be loosened later by switching detection mode.

create table if not exists public.auth_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- sha256(cookie_value), stored as bytea. Unique so a leaked cookie
  -- can be revoked by deleting the row; collisions are 2^-256.
  token_hash bytea not null unique,

  -- Short human-readable summary derived from the user-agent at first
  -- sign-in: "Chrome on macOS", "Safari on iPhone". For a future
  -- /dashboard/security devices list. Nullable because we can fail to
  -- parse exotic UAs.
  label text,

  -- IP context. `ip_first_seen` is frozen at row creation; `last_ip`
  -- gets updated on every successful match (or on every successful
  -- re-OTP after a mismatch). Plain text; we don't index/range these.
  ip_first_seen text,
  last_ip text,

  -- Optional Cloudflare-provided ISO country code at first sign-in.
  -- Useful as a corroborating signal in the verification email
  -- ("logged in from PL"). Nullable for non-Cloudflare environments.
  country_first_seen text,
  country_last_seen text,

  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_trusted_devices_user
  on public.auth_trusted_devices(user_id);

-- Used by the housekeeping prune. Partial wouldn't help (expires_at
-- moves forward over time as devices are touched).
create index if not exists idx_auth_trusted_devices_expires
  on public.auth_trusted_devices(expires_at);

alter table public.auth_trusted_devices enable row level security;

-- Owner can list their own devices (for the future /dashboard/security
-- "active devices" page). Service role is used by the sign-in route
-- and bypasses RLS naturally.
drop policy if exists auth_trusted_devices_self_select on public.auth_trusted_devices;
create policy auth_trusted_devices_self_select on public.auth_trusted_devices
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Owner can revoke (= delete) their own devices. The current device
-- can revoke itself; on the next request, the missing row triggers
-- the OTP flow as if it were a new device.
drop policy if exists auth_trusted_devices_self_delete on public.auth_trusted_devices;
create policy auth_trusted_devices_self_delete on public.auth_trusted_devices
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT/UPDATE policies for any non-service role. Writes only ever
-- happen from the sign-in / verify-device routes via the admin client.
