-- 0051_get_listing_contact_filter_fixtures.sql
-- Defensive: extend `get_listing_contact()` with the same fixture-org
-- filter every other public surface already applies (R11 in
-- docs/RISKS.md — RLS test fixtures live in the same Supabase project
-- as production; public surfaces must filter `aho-test-org-%` slugs
-- so fixture data never leaks).
--
-- Discovered during the 2026-05-12 adversarial audit of the 5
-- SECURITY DEFINER functions we deliberately left anon-callable. The
-- function lacked the filter that the rest of the codebase (sitemap,
-- city landing, agent profile, by-bbox API) all apply. While RLS test
-- runs are ephemeral, during a test run an attacker calling
-- `/rest/v1/rpc/get_listing_contact` with a probed property_id could
-- have received fixture-agent profile data (name, phone, socials).
--
-- The function body is otherwise unchanged.

create or replace function public.get_listing_contact(p_property_id uuid)
returns table (
  agent_full_name text,
  agent_phone text,
  agent_whatsapp_phone text,
  agent_avatar_url text,
  agent_bio text,
  agent_website_url text,
  agent_facebook_url text,
  agent_instagram_url text,
  agent_linkedin_url text,
  agent_specialties text[],
  agent_languages_spoken text[],
  org_id uuid,
  org_name text
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    pf.full_name as agent_full_name,
    pf.phone as agent_phone,
    pf.whatsapp_phone as agent_whatsapp_phone,
    pf.avatar_url as agent_avatar_url,
    pf.bio as agent_bio,
    pf.website_url as agent_website_url,
    pf.facebook_url as agent_facebook_url,
    pf.instagram_url as agent_instagram_url,
    pf.linkedin_url as agent_linkedin_url,
    pf.specialties as agent_specialties,
    pf.languages_spoken as agent_languages_spoken,
    o.id as org_id,
    o.name as org_name
  from public.properties p
  join public.profiles pf on pf.id = p.created_by
  join public.organizations o on o.id = p.org_id
  where p.id = p_property_id
    and p.status = 'active'
    and p.published_at is not null
    -- R11 defensive: exclude fixture organizations + fixture listings.
    -- Matches the pattern in src/lib/listings/queries.ts and the
    -- city-landing / agent-profile / sitemap routes.
    and o.slug not like 'aho-test-org-%'
    and (p.slug_en is null or p.slug_en not like 'aho-fixture-%')
    and (p.slug_es is null or p.slug_es not like 'aho-fixture-%');
$function$;

-- Re-attach the grant intent from 0049/0050: this is anon-callable by
-- design (public lead form), but PUBLIC default-grant was removed in
-- 0050 — direct anon/authenticated grants remain in place because
-- CREATE OR REPLACE preserved them. No additional grants needed.
