-- 0050_revoke_public_execute_on_security_definer.sql
-- Follow-up to 0049. The per-role REVOKEs in 0049 cut the explicit
-- anon/authenticated grants on 22 SECURITY DEFINER functions, but the
-- Supabase advisor kept counting them as "executable by anon" because
-- Postgres default-grants EXECUTE to PUBLIC (the everyone pseudo-role)
-- on every CREATE FUNCTION, and PUBLIC inherits to anon at execute
-- time. Revoking from PUBLIC closes the inheritance path.
--
-- We keep PUBLIC EXECUTE on exactly 5 functions that MUST stay anon-
-- callable:
--   - is_platform_admin()           — used by 28 RLS SELECT/UPDATE policies
--   - get_user_org_role(uuid)       — used by 14 RLS policies
--   - can_insert_listing(uuid)      — used by 1 RLS INSERT policy
--   - get_listing_contact(uuid)     — anon-callable for the property-
--                                     page lead form (intentional public API)
--   - verify_review_token(text)     — anon-callable for the
--                                     /reviews/verify path (intentional)
--
-- Everything else we own gets `revoke execute from public`. After this
-- migration, anon/authenticated/service_role access is determined
-- exclusively by their direct grants (set in 0049 + Supabase defaults),
-- with no PUBLIC backdoor.

-- ============================================================
-- Group A — service_role only (already revoked from anon+authenticated in 0049)
-- ============================================================

revoke execute on function public.check_auth_lockout(public.citext) from public;
revoke execute on function public.record_auth_failure(public.citext, text, text) from public;
revoke execute on function public.prune_auth_failures(public.citext) from public;
revoke execute on function public.upsert_platform_token(
  uuid, text, text, text, text, text, timestamptz, text[], text, inet, text
) from public;
revoke execute on function public.get_decrypted_access_token(uuid, text, text, text) from public;
revoke execute on function public.get_decrypted_refresh_token(uuid, text, text, text) from public;
revoke execute on function public.release_founder_rate_slot(uuid) from public;
revoke execute on function public.claim_founder_rate_slot() from public;
revoke execute on function public.count_active_founder_grants() from public;
revoke execute on function public.recompute_agent_stats(uuid) from public;
revoke execute on function public.recompute_org_current_subscription(uuid) from public;
revoke execute on function public.get_user_buyer_tier(uuid) from public;

-- 0049 left these three as service_role-only via routine_privileges,
-- but they retain a PUBLIC default-grant. Plug that.
revoke execute on function public.claim_founder_rate_slot_with_grant(uuid, uuid, text) from public;
revoke execute on function public.record_property_view(uuid, uuid, uuid, text, text) from public;
revoke execute on function public.materialize_subscription_from_checkout(
  uuid, text, text, text, integer, integer, text, text, text,
  timestamptz, timestamptz, boolean, timestamptz
) from public;

-- ============================================================
-- Group B — authenticated only (already revoked from anon in 0049)
-- ============================================================

revoke execute on function public.admin_org_counts() from public;
revoke execute on function public.admin_user_membership_counts() from public;
revoke execute on function public.merge_anon_recent_views(uuid, uuid) from public;
revoke execute on function public.sweep_stale_pending_images(uuid, integer) from public;

-- ============================================================
-- Group C — triggers (already revoked from anon+authenticated in 0049)
-- ============================================================
-- Triggers don't need EXECUTE for any role — they run as the table
-- owner. PUBLIC revoke makes that explicit and clears the advisor.

revoke execute on function public.enforce_listing_cap_on_transition() from public;
revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.refresh_org_current_subscription_trigger() from public;
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.set_property_latlng() from public;
revoke execute on function public.update_property_image_count() from public;

-- ============================================================
-- DELIBERATELY NOT REVOKED — these MUST remain anon-callable
-- ============================================================
--   - public.is_platform_admin()         (28 RLS refs)
--   - public.get_user_org_role(uuid)     (14 RLS refs)
--   - public.can_insert_listing(uuid)    (1  RLS ref)
--   - public.get_listing_contact(uuid)   (public lead form API)
--   - public.verify_review_token(text)   (public review-verify API)
