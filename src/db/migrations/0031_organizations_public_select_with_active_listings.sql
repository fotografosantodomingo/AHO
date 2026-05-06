-- 0031_organizations_public_select_with_active_listings.sql
--
-- Add a narrow public-read policy on `public.organizations` so anon
-- visitors (and SEO crawlers) can resolve the inner-join `properties ×
-- organizations` that powers:
--   - sitemap.xml + sitemap-images.xml (main SEO surfaces)
--   - getCountriesIndex (countries directory page)
--   - getCountryCities (country landing pages)
--   - searchCityLanding (city landing pages)
--   - fetchAgentProfile (public agent profile page)
--
-- Background: migration 0002 created `organizations` with three policies:
--   - organizations_member_select  (members only)
--   - organizations_admin_update   (UPDATE — owner/manager)
--   - organizations_platform_admin_all  (super-admins)
--
-- None of those grant SELECT to anon. So a query like
--   .from('properties').select('... organizations!inner(slug)')
-- returns ZERO rows when run as anon — PostgREST inner-join requires
-- reading both sides of the join through RLS.
--
-- The bug surfaces as: SEO surfaces show only marketing chrome (~10
-- URLs), no listings / cities / agent profiles. searchListings()
-- happens to work because it doesn't inner-join organizations; but
-- every public surface that needs the org slug for canonical URLs is
-- broken for anon. PO-noticed 2026-05-05 when /sitemap-images.xml
-- emitted an empty <urlset>.
--
-- Fix: anon can SELECT an organization row IFF the org has at least one
-- ACTIVE+PUBLISHED property. This preserves privacy for orgs whose
-- listings are all drafts/archived — they remain invisible to anon —
-- while letting crawlers + public pages resolve the inner-join for any
-- org with public content.
--
-- The EXISTS subquery uses the partial index `idx_properties_org_active`
-- (already present from migration 0007) so the filter is cheap.

drop policy if exists organizations_public_select_with_active_listings on public.organizations;
create policy organizations_public_select_with_active_listings on public.organizations
  for select
  using (
    exists (
      select 1
      from public.properties p
      where p.org_id = organizations.id
        and p.status = 'active'
        and p.published_at is not null
    )
  );

comment on policy organizations_public_select_with_active_listings on public.organizations is
  'Anon-readable iff the org has at least one active+published listing. Powers public SEO surfaces (sitemap, city/country/agent pages) that inner-join organizations × properties.';
