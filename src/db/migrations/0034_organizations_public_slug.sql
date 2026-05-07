-- 0034_organizations_public_slug.sql
--
-- SEO-friendly public slug for agent profile pages.
--
-- The existing `organizations.slug` is auto-generated at signup from the
-- org name (e.g., "ACME Realty" → "acme-realty-1234"). It works as a
-- stable URL key but doesn't carry the SEO weight Google rewards on
-- people-search queries — agents get found by their *name* + city, not
-- by their company.
--
-- Format of the new public slug:
--     <slugified-full-name>-<slugified-city>-<lowercased-country-code>
-- e.g., `juan-perez-santo-domingo-do`, `michal-baba-warsaw-pl`.
--
-- Generation lives in the app (`src/lib/agents/public-slug.ts`); after a
-- successful PUT /api/me/profile, the route resolves the user's owned
-- org and writes the recomputed slug here. Collision handling appends
-- `-2`, `-3`, etc. if another org already holds the base form.
--
-- The legacy `organizations.slug` stays — /agents/<old-slug> 301-redirects
-- to /agents/<public_slug> so existing inbound links don't break.
--
-- Index: unique partial — null is allowed (orgs whose owner hasn't filled
-- the profile fields yet have NULL public_slug; the public route falls
-- back to the legacy slug for those).

alter table public.organizations
  add column if not exists public_slug text;

create unique index if not exists idx_organizations_public_slug_unique
  on public.organizations (public_slug)
  where public_slug is not null;

create index if not exists idx_organizations_public_slug_lookup
  on public.organizations (public_slug)
  where public_slug is not null;
