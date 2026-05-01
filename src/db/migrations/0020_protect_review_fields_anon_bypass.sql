-- 0020_protect_review_fields_anon_bypass.sql
-- Follow-on to 0019. The trigger now raises "Not authorized" for
-- legitimate SECURITY DEFINER paths called from anon contexts —
-- specifically `verify_review_token()`, where the caller's JWT has
-- `role='anon'` (not service_role, not null).
--
-- 0019 covered: service_role JWT, no-JWT (direct DB).
-- 0020 adds:    anon JWT (anon → SECURITY DEFINER → UPDATE).
--
-- Why this is safe: RLS policies for `reviews` UPDATE only grant
-- access to authenticated users (reviewer_self_pending, agent_reply,
-- admin_update). There is NO anon UPDATE policy. So an anon caller
-- has only one legitimate path to UPDATE reviews — through a
-- SECURITY DEFINER function that the platform explicitly grants
-- execute on (verify_review_token). The trigger's column-restriction
-- logic exists to gate AUTHENTICATED user-context updates from
-- exceeding their permitted column scope. For anon, RLS handles the
-- gating; the trigger has nothing useful to do.

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

  -- Trusted contexts: skip column restriction.
  --   - service_role JWT (admin client paths)
  --   - anon JWT (only legitimate UPDATE path is via SECURITY DEFINER
  --     RPCs we explicitly grant; RLS blocks direct anon UPDATEs)
  --   - no JWT (direct DB / migrations / postgres superuser)
  if v_jwt_role in ('service_role', 'anon') or auth.jwt() is null then
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

  -- Reviewer-self path. Both ids must be non-null for the match
  -- (avoids the 0016 NULL-equality bug fixed by 0019).
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

  -- Target-agent reply path on published.
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
