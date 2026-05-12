-- 0049_tighten_security_definer_grants.sql
-- Tighten EXECUTE grants on SECURITY DEFINER functions so the surface
-- exposed to anon/authenticated via PostgREST /rest/v1/rpc/... matches
-- the actual call sites in our app code. Resolves a large chunk of the
-- Supabase advisor's `anon_security_definer_function_executable` +
-- `authenticated_security_definer_function_executable` findings.
--
-- Audited every SECURITY DEFINER function in public against three
-- signals before deciding:
--   1. Function body: is there an internal auth check?
--   2. Call sites in our code (grep): admin client (service_role) or
--      user-context client (anon/authenticated)?
--   3. RLS references (pg_policy.polqual/polwithcheck): is the function
--      referenced from any policy — if yes, the role doing the read
--      must keep EXECUTE.
--
-- Functions referenced from RLS policies (28 + 14 + 1 = 43 mentions
-- across all policies) — these MUST keep anon+authenticated EXECUTE
-- and are not touched here:
--   - is_platform_admin()              (28 policies)
--   - get_user_org_role(uuid)          (14 policies)
--   - can_insert_listing(uuid)         (1  policy)
--
-- Functions intentionally callable by anon — verified safe by internal
-- design — also not touched:
--   - get_listing_contact(uuid)        (anon-callable property page lead form)
--   - verify_review_token(text)        (anon-callable review verification path)
--
-- PostGIS internals (st_estimatedextent ×3) — owned by supabase_admin,
-- we can't alter their grants. Tracked under R13 in docs/RISKS.md.
--
-- Already service_role-only and unchanged:
--   - claim_founder_rate_slot_with_grant(uuid, uuid, text)
--   - materialize_subscription_from_checkout(...)
--   - record_property_view(uuid, uuid, uuid, text, text)

-- ============================================================
-- Group A — service_role only (revoke from anon + authenticated)
-- ============================================================
-- These are called exclusively from server-side admin-client paths;
-- the public RPC surface was an accidental leak from Supabase's
-- default grants. Most carry real risk if anon could invoke them.

-- auth lockout machinery — called from src/lib/auth/lockout.ts via
-- createAdminClient(). Anon-callable `prune_auth_failures` would let
-- an attacker reset the failure counter for a victim email and slip
-- past the progressive cooldown.
revoke execute on function public.check_auth_lockout(public.citext)
  from anon, authenticated;
revoke execute on function public.record_auth_failure(public.citext, text, text)
  from anon, authenticated;
revoke execute on function public.prune_auth_failures(public.citext)
  from anon, authenticated;

-- OAuth token vault — called from /api/oauth/* and /api/cron/* via
-- admin client. The `p_key` argument is the pgcrypto symmetric key
-- (server env). Currently anon could brute-force decryption if the
-- key ever leaked; closing the public RPC surface is defence in
-- depth, the env-key isolation is the primary control.
revoke execute on function public.upsert_platform_token(
  uuid, text, text, text, text, text, timestamptz, text[], text, inet, text
) from anon, authenticated;
revoke execute on function public.get_decrypted_access_token(uuid, text, text, text)
  from anon, authenticated;
revoke execute on function public.get_decrypted_refresh_token(uuid, text, text, text)
  from anon, authenticated;

-- Founder-rate counter — called from Stripe webhook handlers via
-- admin client. Anon-callable `release_founder_rate_slot` would let
-- an attacker free other agents' founder slots.
revoke execute on function public.release_founder_rate_slot(uuid)
  from anon, authenticated;
revoke execute on function public.claim_founder_rate_slot()
  from anon, authenticated;
revoke execute on function public.count_active_founder_grants()
  from anon, authenticated;

-- Recompute helpers — called only from triggers (which run as the
-- table owner, not the EXECUTE-granted role). No public call sites.
revoke execute on function public.recompute_agent_stats(uuid)
  from anon, authenticated;
revoke execute on function public.recompute_org_current_subscription(uuid)
  from anon, authenticated;

-- Unused helper — defined but no callers in app code or RLS.
revoke execute on function public.get_user_buyer_tier(uuid)
  from anon, authenticated;

-- ============================================================
-- Group B — authenticated only (revoke from anon)
-- ============================================================
-- Internal auth check is present in each, but exposing them to anon
-- is needless attack surface (anon would just get empty results
-- anyway).

-- Admin dashboard counters — called from /admin/orgs and /admin/users
-- via user-context client. Each filters internally on
-- (select is_admin from profiles where id = auth.uid()) = true.
revoke execute on function public.admin_org_counts() from anon;
revoke execute on function public.admin_user_membership_counts() from anon;

-- Called from /auth/callback after sign-in completes — the user is
-- authenticated by the time the merge runs.
revoke execute on function public.merge_anon_recent_views(uuid, uuid) from anon;

-- Called from /api/properties/[id]/images by the agent uploading.
revoke execute on function public.sweep_stale_pending_images(uuid, integer) from anon;

-- ============================================================
-- Group C — triggers (revoke from anon + authenticated)
-- ============================================================
-- Triggers execute as the table owner, not the connection's role, so
-- removing EXECUTE from anon/authenticated doesn't break anything.
-- Keeping the grants just inflated the advisor's noise floor.

revoke execute on function public.enforce_listing_cap_on_transition()
  from anon, authenticated;
revoke execute on function public.handle_new_auth_user()
  from anon, authenticated;
revoke execute on function public.refresh_org_current_subscription_trigger()
  from anon, authenticated;
revoke execute on function public.rls_auto_enable()
  from anon, authenticated;
revoke execute on function public.set_property_latlng()
  from anon, authenticated;
revoke execute on function public.update_property_image_count()
  from anon, authenticated;
