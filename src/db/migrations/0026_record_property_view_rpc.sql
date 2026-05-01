-- 0026_record_property_view_rpc.sql
-- feat/recently-viewed companion: SECURITY DEFINER RPC for the
-- "upsert a recent view" path.
--
-- Why an RPC instead of supabase.from(...).upsert():
-- PostgREST's upsert ON CONFLICT clause doesn't support partial
-- unique indexes. Migration 0025 declared TWO partial uniques —
-- (user_id, property_id) WHERE user_id IS NOT NULL, and the same
-- shape on anonymous_id — because the visitor identity is
-- mutually-exclusive (a row has user_id XOR anonymous_id, never both).
-- A regular unique can't model this.
--
-- This function does the right INSERT … ON CONFLICT … WHERE branch
-- based on which identity field is set, so the upsert lands on
-- whichever partial-unique applies. Service-role only.

create or replace function public.record_property_view(
  p_user_id uuid,
  p_anonymous_id uuid,
  p_property_id uuid,
  p_locale text,
  p_source_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is not null then
    insert into public.property_recent_views (
      user_id, anonymous_id, property_id, viewed_at, locale, source_path
    ) values (
      p_user_id, null, p_property_id, now(), p_locale, p_source_path
    )
    on conflict (user_id, property_id) where user_id is not null
    do update set
      viewed_at = excluded.viewed_at,
      locale = excluded.locale,
      source_path = excluded.source_path;
  elsif p_anonymous_id is not null then
    insert into public.property_recent_views (
      user_id, anonymous_id, property_id, viewed_at, locale, source_path
    ) values (
      null, p_anonymous_id, p_property_id, now(), p_locale, p_source_path
    )
    on conflict (anonymous_id, property_id) where anonymous_id is not null
    do update set
      viewed_at = excluded.viewed_at,
      locale = excluded.locale,
      source_path = excluded.source_path;
  end if;
end;
$$;

revoke execute on function public.record_property_view(uuid, uuid, uuid, text, text)
  from anon, authenticated;
