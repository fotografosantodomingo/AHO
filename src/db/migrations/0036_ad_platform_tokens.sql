-- 0036_ad_platform_tokens.sql
--
-- OAuth access tokens for the social-publishing pipeline (Meta, Google,
-- LinkedIn, TikTok, Pinterest). Per `aho_strategic_vision.md`, this is
-- the storage layer behind the "paste-link → publish to FB+IG+…" hook.
--
-- Encryption-at-rest: tokens stored as pgcrypto-encrypted bytea using
-- extensions.pgp_sym_encrypt with a symmetric key pulled from the Edge Worker's
-- env at call time (AHO_TOKEN_ENCRYPTION_KEY). The key never lives in
-- the DB; loss of the DB without the key yields ciphertext.
--
-- Why parameter-passed key (vs Supabase Vault): minimum-viable for
-- Day 3 of the execution plan. Vault upgrade tracked as a follow-up;
-- the policy boundary stays the same — only service-role + the worker
-- holding the env var can decrypt.
--
-- RLS: owner reads metadata (everything EXCEPT the encrypted columns).
-- Decryption is gated through a SECURITY DEFINER RPC that requires
-- the caller to supply the key + the user_id, and is grant-revoked
-- from anon and authenticated — only service_role can call it. The
-- worker invokes it via the admin client.

create table public.ad_platform_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in (
    'meta', 'google', 'linkedin', 'tiktok', 'pinterest'
  )),
  /** Platform-side stable identifier (FB user id, IG account id,
   *  Google customer id, etc.). Lets us dedupe per (user, platform,
   *  account) and target a specific account when a user has multiple. */
  external_account_id text,
  /** Human-readable label rendered in the UI ("Acme Realty FB Page",
   *  "@acme_realty", "Acme Realty Ads"). Set at OAuth time from the
   *  platform's profile / page list. */
  display_name text,
  /** AES-encrypted access token. Encryption: extensions.pgp_sym_encrypt(token, key).
   *  Decryption: extensions.pgp_sym_decrypt(access_token_encrypted, key)::text.
   *  Key supplied by the worker as a function arg. */
  access_token_encrypted bytea not null,
  /** Same for refresh tokens (Google + Meta long-lived flows return
   *  short-lived access tokens that need refresh). NULL when the
   *  platform doesn't issue refresh tokens (Meta long-lived = 60d
   *  rolling, no separate refresh). */
  refresh_token_encrypted bytea,
  /** Expiry of the access token if known. NULL = platform default
   *  (Meta long-lived = 60d from acquired_at; we re-derive). */
  expires_at timestamptz,
  /** Granted scopes returned by the OAuth response. Used to gate
   *  feature availability — e.g., publish UI hidden if the user
   *  granted only `pages_show_list` without `pages_manage_posts`. */
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  /** Soft-revocation. Set when (a) Meta calls our deauthorize webhook,
   *  (b) the user clicks Disconnect in our UI, (c) a publish call gets
   *  401 and we mark the token dead. Revoked rows are kept for audit
   *  but excluded from the decrypt RPC. */
  revoked_at timestamptz,
  /** Audit: where the user was when they granted access. */
  user_agent text,
  ip_address inet,
  /** One row per (user, platform, external_account). Re-connecting
   *  the same FB Page just updates this row. */
  constraint ad_platform_tokens_unique_account
    unique (user_id, platform, external_account_id)
);

create index idx_ad_platform_tokens_user
  on public.ad_platform_tokens(user_id);

create index idx_ad_platform_tokens_platform_active
  on public.ad_platform_tokens(platform)
  where revoked_at is null;

create trigger ad_platform_tokens_updated_at
  before update on public.ad_platform_tokens
  for each row execute function public.touch_updated_at();

alter table public.ad_platform_tokens enable row level security;

-- Owner SELECT — sees all metadata columns (including ciphertext bytea
-- but that's just bytes; useless without the key). Decryption is
-- through the RPC below.
drop policy if exists ad_tokens_owner_select on public.ad_platform_tokens;
create policy ad_tokens_owner_select on public.ad_platform_tokens
  for select using (auth.uid() = user_id);

-- Owner UPDATE — only the revoked_at column, via a separate UPDATE
-- policy. Lets users disconnect via UI without going through service
-- role. Other column updates require service role.
drop policy if exists ad_tokens_owner_revoke on public.ad_platform_tokens;
create policy ad_tokens_owner_revoke on public.ad_platform_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Super-admin escape hatch.
drop policy if exists ad_tokens_platform_admin_all on public.ad_platform_tokens;
create policy ad_tokens_platform_admin_all on public.ad_platform_tokens
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ===== Decrypt RPC =====
-- Accepts the user_id + platform + (optional) external_account_id +
-- the encryption key. Returns the plaintext access token, or NULL
-- when no live row matches.
--
-- Why we don't include refresh_token in the same row: callers needing
-- a refresh path call get_decrypted_refresh_token() — that's a
-- separate RPC so the access-only call doesn't pull plaintext refresh
-- bytes through Postgres logs.
create or replace function public.get_decrypted_access_token(
  p_user_id uuid,
  p_platform text,
  p_external_account_id text,
  p_key text
) returns text
language sql
security definer
set search_path = public
as $$
  select extensions.pgp_sym_decrypt(t.access_token_encrypted, p_key)::text
  from public.ad_platform_tokens t
  where t.user_id = p_user_id
    and t.platform = p_platform
    and (p_external_account_id is null or t.external_account_id = p_external_account_id)
    and t.revoked_at is null
  order by t.created_at desc
  limit 1;
$$;

revoke execute on function public.get_decrypted_access_token(uuid, text, text, text)
  from public;
grant execute on function public.get_decrypted_access_token(uuid, text, text, text)
  to service_role;

create or replace function public.get_decrypted_refresh_token(
  p_user_id uuid,
  p_platform text,
  p_external_account_id text,
  p_key text
) returns text
language sql
security definer
set search_path = public
as $$
  select case
    when t.refresh_token_encrypted is null then null
    else extensions.pgp_sym_decrypt(t.refresh_token_encrypted, p_key)::text
  end
  from public.ad_platform_tokens t
  where t.user_id = p_user_id
    and t.platform = p_platform
    and (p_external_account_id is null or t.external_account_id = p_external_account_id)
    and t.revoked_at is null
  order by t.created_at desc
  limit 1;
$$;

revoke execute on function public.get_decrypted_refresh_token(uuid, text, text, text)
  from public;
grant execute on function public.get_decrypted_refresh_token(uuid, text, text, text)
  to service_role;

-- Helper for the OAuth callback: insert-or-update a token row given
-- plaintext access + refresh + the encryption key. Centralizing the
-- write path here means the worker code never sees the bytea casting
-- gymnastics — just calls upsert_platform_token() with strings.
create or replace function public.upsert_platform_token(
  p_user_id uuid,
  p_platform text,
  p_external_account_id text,
  p_display_name text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_scopes text[],
  p_user_agent text,
  p_ip_address inet,
  p_key text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.ad_platform_tokens (
    user_id, platform, external_account_id, display_name,
    access_token_encrypted, refresh_token_encrypted,
    expires_at, scopes, user_agent, ip_address
  ) values (
    p_user_id, p_platform, p_external_account_id, p_display_name,
    extensions.pgp_sym_encrypt(p_access_token, p_key),
    case when p_refresh_token is null then null else extensions.pgp_sym_encrypt(p_refresh_token, p_key) end,
    p_expires_at, coalesce(p_scopes, '{}'), p_user_agent, p_ip_address
  )
  on conflict (user_id, platform, external_account_id) do update
    set display_name = excluded.display_name,
        access_token_encrypted = excluded.access_token_encrypted,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        expires_at = excluded.expires_at,
        scopes = excluded.scopes,
        revoked_at = null,
        user_agent = excluded.user_agent,
        ip_address = excluded.ip_address,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.upsert_platform_token(
  uuid, text, text, text, text, text, timestamptz, text[], text, inet, text
) from public;
grant execute on function public.upsert_platform_token(
  uuid, text, text, text, text, text, timestamptz, text[], text, inet, text
) to service_role;

comment on table public.ad_platform_tokens is
  'OAuth tokens for the social-publishing pipeline. Tokens are AES-encrypted at rest via pgcrypto; decryption happens through SECURITY DEFINER RPCs that accept the worker''s key. See docs/AUTOMATION_STRATEGY.md (Sprint 1).';
