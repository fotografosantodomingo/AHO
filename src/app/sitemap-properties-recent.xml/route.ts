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
 * GET /sitemap-properties-recent.xml — last-7-day published listings.
 *
 * Why a separate sub-sitemap for recent listings: Google News Sitemap
 * (the obvious next reflex when "I want crawlers to prioritise new
 * content") doesn't apply to real estate — Google News Publisher Center
 * requires registration as a journalistic news outlet and listings
 * would be rejected. The right primitive for "freshness signal to
 * crawlers" on commerce/listings is a tightly-scoped sub-sitemap with
 * priority=1.0 + changefreq=daily. Google + Bing + Yandex all read
 * this and re-fetch more aggressively.
 *
 * The full /sitemap-properties.xml stays at priority=0.8 + changefreq=
 * weekly. This recent-only file is the "yes really, look at these"
 * signal layered on top.
 *
 * 7-day window picked because:
 *  - Most listings get their initial crawl + indexing within 3-5 days.
 *  - After 7 days, the listing is no longer "new" — it's an existing
 *    listing competing on its own merits in the main sitemap.
 *  - Short window = small file = trivially small crawl-budget cost
 *    if Google re-fetches frequently.
 *
 * Paired with IndexNow ping at publish time (lib/seo/indexnow.ts +
 * /api/listings/[id]/publish handler) — sitemap signals freshness for
 * crawlers that already discovered the URL; IndexNow tells them about
 * URLs they haven't seen yet.
 */

const RECENT_WINDOW_DAYS = 7;

export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const rows = await fetchSitemapListings();
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const entries: UrlEntry[] = [];
  for (const row of rows) {
    // Filter to listings published within the recent window.
    const pubMs = row.published_at ? new Date(row.published_at).getTime() : 0;
    if (pubMs < cutoff) continue;

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
        changefreq: 'daily',
        priority: 1.0,
        alternates: languages,
      });
    }
    if (esUrl) {
      entries.push({
        loc: esUrl,
        lastmod,
        changefreq: 'daily',
        priority: 1.0,
        alternates: languages,
      });
    }
  }

  // Short cache (1 min browser / 5 min CDN). This file changes whenever
  // a new listing publishes AND whenever a listing falls out of the
  // 7-day window — both happen at unpredictable hours.
  return xmlResponse(renderSitemap(entries), 60);
}
