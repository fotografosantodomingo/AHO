import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Shared row-loader for the sitemap routes (Phase: sitemap-index split
 * 2026-05-14). The /sitemap-properties.xml, /sitemap-agents.xml, and
 * /sitemap-locations.xml routes all read the same active+published-
 * listings set; centralising the query here keeps the fixture-org
 * filter + the org-inner-join consistent across them.
 *
 * Fixture exclusion: per CLAUDE.md "Local-dev quirks" + RISKS R11,
 * test fixtures live in the production Supabase project. Their org
 * slug is prefixed `aho-test-org-` and listing slugs prefixed
 * `aho-fixture-`. CLAUDE.md hard rule #8 forbids them from appearing
 * in any user-visible surface — and `sitemap.xml` is user-visible
 * (Google is the user). Filter at both layers as defence in depth.
 */

export interface SitemapListingRow {
  short_id: string;
  slug_en: string | null;
  slug_es: string | null;
  updated_at: string | null;
  published_at: string | null;
  status: string;
  country_code: string | null;
  city: string | null;
  organizations: SitemapListingOrg | SitemapListingOrg[] | null;
}

export interface SitemapListingOrg {
  slug: string | null;
  public_slug: string | null;
  name: string | null;
  updated_at: string | null;
}

const SITEMAP_LISTINGS_LIMIT = 50_000;

/**
 * Fetch every active+published listing with its org joined. Excludes
 * fixture orgs and fixture listings. Used by /sitemap-properties.xml,
 * /sitemap-agents.xml, /sitemap-locations.xml. Returns `[]` on error.
 */
export async function fetchSitemapListings(): Promise<SitemapListingRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select(
      'short_id, slug_en, slug_es, updated_at, published_at, status, country_code, city, organizations!inner(slug, public_slug, name, updated_at)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(SITEMAP_LISTINGS_LIMIT);
  if (error || !data) return [];
  // Defensive second-layer filter — drop any row whose listing slugs
  // start with the fixture prefix even if the org passed.
  return data.filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );
}

/** Read .organizations regardless of whether PostgREST returned object or array. */
export function extractOrg(
  row: Pick<SitemapListingRow, 'organizations'>,
): SitemapListingOrg | null {
  const o = row.organizations;
  if (!o) return null;
  if (Array.isArray(o)) return o[0] ?? null;
  return o;
}
