-- 0019_protect_review_fields_jwt_aware.sql
-- Fix `protect_review_fields()` from 0016 to handle non-user-context
-- callers (service-role, no-JWT/SECURITY DEFINER) without falling
-- through to "raise exception" or — worse — silently mis-classifying
-- a SECURITY DEFINER caller as "the reviewer is editing while pending
-- and so we should restrict to body/rating/locale and revert the
-- status change."
--
-- The original 0016 trigger checked `auth.uid()` and `is_platform_admin()`,
-- then fell into branch 2 when `old.reviewer_user_id is not distinct
-- from v_caller`. Postgres treats `NULL is not distinct from NULL` as
-- TRUE — so a SECURITY DEFINER call from anon (where auth.uid() is
-- NULL) on a row with reviewer_user_id NULL hit branch 2, restricted
-- columns to {body, rating, locale}, and silently undid the status
-- flip we wanted. That's why `verify_review_token()` returned
-- success=true while the row stayed at status='pending_verification'.
--
-- New posture (matches the 0018 protect_profile_admin_fields fix):
--   - service_role JWT     → permit (no column restriction).
--   - no-JWT context       → permit (SECURITY DEFINER calls, migrations,
--                            scheduled jobs, postgres superuser).
--   - admin user JWT       → permit.
--   - reviewer user JWT    → restrict to body/rating/locale while pending.
--   - target agent user JWT → restrict to agent_reply only on published.
--   - other authenticated  → raise; defense-in-depth, RLS should have
--                            blocked already.

create or replace function public.protect_review_fields()
returns trigger
language plpgsql
as $$
declare
  v_caller uuid;
  v_jwt_role text;
  v_is_admin boolean;
begin
  v_jwt_role := auth.jwt() ->> 'role';

  -- Trusted contexts: skip column restriction entirely.
  --   - service_role JWT: app-driven admin paths
  --   - no JWT: direct DB / SECURITY DEFINER (verify_review_token RPC,
  --     migrations, postgres superuser). These are server-side and
  --     trusted by construction.
  if v_jwt_role = 'service_role' or auth.jwt() is null then
    return new;
  end if;

  v_caller := (select auth.uid());
  v_is_admin := public.is_platform_admin();

  if v_is_admin then
    if new.status is distinct from old.status then
      new.moderated_at := now();
      new.moderated_by := v_caller;
    end if;
    return new;
  end if;

  -- Reviewer-self path: the reviewer (must have a non-null user id —
  -- this is the bug fix; the original was `is not distinct from`
  -- which matched NULL = NULL) editing while pending verification.
  if old.reviewer_user_id is not null
     and old.reviewer_user_id = v_caller
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

  -- Target-agent reply path: agent updating their own published review.
  if v_caller is not null
     and old.agent_id = v_caller
     and old.status = 'published' then
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
    if new.agent_reply is distinct from old.agent_reply and new.agent_reply is not null then
      new.agent_replied_at := now();
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this review (caller=%, status=%)', v_caller, old.status;
end;
$$;
