-- 0012_profile_extensions.sql
-- Extend profiles with the fields agents need for a real public profile:
-- bio, separate WhatsApp number, website + social links, specialties +
-- languages tag arrays. All optional with sensible defaults so existing
-- rows aren't disturbed and RLS stays unchanged.

alter table public.profiles
  add column if not exists bio text,
  -- Some agents use a different number for WhatsApp than for regular
  -- calls. Keep phone for calls/SMS; whatsapp_phone for WhatsApp links.
  -- get_listing_contact() prefers whatsapp_phone over phone for the
  -- WhatsApp button on the listing detail page.
  add column if not exists whatsapp_phone text,
  add column if not exists website_url text,
  add column if not exists facebook_url text,
  add column if not exists instagram_url text,
  add column if not exists linkedin_url text,
  -- Free-text tag arrays — agents pick their own (the form provides a
  -- common-suggestions chip list but doesn't constrain to it).
  add column if not exists specialties text[] not null default '{}',
  add column if not exists languages_spoken text[] not null default '{}';

-- Update get_listing_contact (from migration 0009) to return the new
-- fields the property detail page needs for the agent card. Old callers
-- get the same first 4 columns + new optional ones; everything stays
-- backwards-compatible. SECURITY DEFINER stays — same anon-safe view of
-- a listing's agent.

drop function if exists public.get_listing_contact(uuid);

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
set search_path = public
as $$
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
    and p.published_at is not null;
$$;

grant execute on function public.get_listing_contact(uuid) to anon, authenticated;
