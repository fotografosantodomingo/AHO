-- 0047_auth_login_challenges.sql
-- Two-phase login: phase 1 validates the password but does not set a
-- session; instead it inserts a challenge row + emails a 6-digit code.
-- Phase 2 verifies the code and only then sets the session cookies via
-- the admin-magiclink → verifyOtp dance (route layer; no DB awareness).
--
-- We deliberately do NOT store the password or the Supabase session
-- tokens here. The challenge row is just a "this email/password pair
-- was valid at this moment, prove device ownership to claim a session"
-- ticket. Phase 2 re-derives the session from scratch via Supabase
-- admin.generateLink(magiclink) so nothing token-bearing lives at rest.
--
-- code_hash is sha256 of the 6-digit code. Same threat model as
-- auth_trusted_devices.token_hash — leaked DB row can't be turned into
-- a code without brute-forcing 1M possibilities, and `attempts` caps
-- the brute force at 5.
--
-- TTL is 15 min (PO directive 2026-05-10). Expired rows are filtered
-- in the lookup; nothing has to actively prune them, though a future
-- cron should sweep for hygiene.

create table if not exists public.auth_login_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- sha256 of the 6-digit code we emailed.
  code_hash bytea not null,

  -- Brute-force cap: after 5 wrong attempts, the route 410-Gones the
  -- challenge and the user has to start over (re-enter password). The
  -- column is bumped on every wrong code submit; phase 2 reads + checks
  -- before re-hashing. No DB-side trigger; route enforces.
  attempts int not null default 0,

  -- Audit context shown in the verification email body so the user
  -- can recognize whether the attempt was theirs.
  ip text,
  country text,
  user_agent text,

  -- Resend tracking. Each resend bumps this; route caps at 3 (initial
  -- + 3 = 4 total emails per challenge) before refusing further sends.
  resend_count int not null default 0,
  last_resent_at timestamptz,

  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Lookup is by id (provided by the client as the challenge handle).
-- Expires_at index helps the housekeeping sweep but isn't on a hot
-- query path.
create index if not exists idx_auth_login_challenges_expires
  on public.auth_login_challenges(expires_at);

-- Per-user lookup for the resend route: "is there an active unconsumed
-- challenge for this user we can re-send?" Partial — only unconsumed.
create index if not exists idx_auth_login_challenges_active
  on public.auth_login_challenges(user_id, created_at desc)
  where consumed_at is null;

alter table public.auth_login_challenges enable row level security;

-- No policies for any role. Service role bypasses RLS, and that's the
-- only thing that should ever read/write this table. Even the user
-- whose challenge it is doesn't need to read it directly — they
-- interact via /api/auth/verify-device which uses the admin client.
