import { publicEnv } from '@/lib/env';
import {
  MARKETING_LASTMOD,
  buildContentAlternates,
  maxDate,
  renderSitemap,
  xmlResponse,
  type UrlEntry,
} from '@/lib/seo/sitemap-helpers';
import { extractOrg, fetchSitemapListings } from '@/lib/seo/sitemap-listings';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /sitemap-agents.xml — every organization with at least one
 * active+published listing. EN + ES URLs.
 *
 * `lastmod` = max(org.updated_at, all-listings.updated_at) — a listing
 * edit refreshes the agent profile's freshness signal even if the org
 * row itself didn't change. Captures "this agent is active" without
 * agents needing to manually touch their profile.
 *
 * URL slug: prefer `public_slug` (SEO-friendly, post-profile-fill);
 * fall back to legacy `slug`. The profile route handles both forms
 * (legacy slug → 301 to public_slug).
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const rows = await fetchSitemapListings();

  const agentMap = new Map<
    string,
    { orgUpdatedAt: string | null; listingDates: Array<string | null> }
  >();
  for (const row of rows) {
    const org = extractOrg(row);
    if (!org) continue;
    const canonical = org.public_slug ?? org.slug;
    if (!canonical) continue;
    const existing = agentMap.get(canonical);
    if (existing) {
      existing.listingDates.push(row.updated_at);
    } else {
      agentMap.set(canonical, {
        orgUpdatedAt: org.updated_at,
        listingDates: [row.updated_at],
      });
    }
  }

  const entries: UrlEntry[] = [];
  for (const [slug, { orgUpdatedAt, listingDates }] of agentMap) {
    const enUrl = `${site}/en/agents/${slug}`;
    const esUrl = `${site}/es/agentes/${slug}`;
    const lastmod =
      maxDate([orgUpdatedAt, ...listingDates]) ?? MARKETING_LASTMOD;
    const languages = buildContentAlternates({ enUrl, esUrl });
    entries.push(
      {
        loc: enUrl,
        lastmod,
        changefreq: 'weekly',
        priority: 0.5,
        alternates: languages,
      },
      {
        loc: esUrl,
        lastmod,
        changefreq: 'weekly',
        priority: 0.5,
        alternates: languages,
      },
    );
  }

  return xmlResponse(renderSitemap(entries), 600);
}
