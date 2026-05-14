import { publicEnv } from '@/lib/env';
import {
  MARKETING_LASTMOD,
  buildContentAlternates,
  maxDate,
  renderSitemap,
  xmlResponse,
  type UrlEntry,
} from '@/lib/seo/sitemap-helpers';
import { fetchSitemapListings } from '@/lib/seo/sitemap-listings';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /sitemap-properties.xml — every active+published property listing,
 * EN + ES URLs, with hreflang alternates.
 *
 * This is the "smart" sub-sitemap from the 2026-05-14 split: when an
 * agent publishes a new listing, ONLY this file changes lastmod. The
 * marketing chrome (/sitemap-pages.xml) + acquisition landings
 * (/sitemap-landings.xml) keep their cached signal intact, so Google
 * doesn't waste crawl budget re-fetching unchanged surfaces. Listing
 * pages get prioritised by the freshness signal that actually matters.
 *
 * Per-URL `lastmod` = max(properties.updated_at, published_at) so a
 * listing edit (price change, photos, copy) refreshes the signal.
 *
 * Fixture filter happens in fetchSitemapListings(); see CLAUDE.md
 * "Local-dev quirks" + RISKS R11 for why.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const rows = await fetchSitemapListings();

  const entries: UrlEntry[] = [];
  for (const row of rows) {
    const enUrl = row.slug_en
      ? `${site}/en/properties/${row.slug_en}-${row.short_id}`
      : null;
    const esUrl = row.slug_es
      ? `${site}/es/propiedades/${row.slug_es}-${row.short_id}`
      : null;
    const lastmod =
      maxDate([row.updated_at, row.published_at]) ?? MARKETING_LASTMOD;
    const languages = buildContentAlternates({ enUrl, esUrl });
    if (enUrl) {
      entries.push({
        loc: enUrl,
        lastmod,
        changefreq: 'weekly',
        priority: 0.8,
        alternates: languages,
      });
    }
    if (esUrl) {
      entries.push({
        loc: esUrl,
        lastmod,
        changefreq: 'weekly',
        priority: 0.8,
        alternates: languages,
      });
    }
  }

  // 5min browser / 10min CDN — listings can change at any time (publish,
  // price update, mark-as-sold), so this is the most dynamic sitemap.
  return xmlResponse(renderSitemap(entries), 300);
}
