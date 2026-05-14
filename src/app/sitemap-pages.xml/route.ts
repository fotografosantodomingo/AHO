import { publicEnv } from '@/lib/env';
import {
  buildMarketingChromeEntries,
  metadataToUrlEntries,
  renderSitemap,
  xmlResponse,
} from '@/lib/seo/sitemap-helpers';

export const runtime = 'edge';

/**
 * GET /sitemap-pages.xml — marketing chrome only (homepage, /pricing,
 * /privacy, /terms, /countries × 7 locales = 35 URLs).
 *
 * Static-ish: `lastmod` is `MARKETING_LASTMOD` (a compile-time constant
 * bumped only when marketing chrome content meaningfully changes).
 * Long cache headers — the URL set + hreflang here are stable.
 *
 * Part of the sitemap-index split shipped 2026-05-14. Master at
 * /sitemap.xml lists this + the dynamic content sitemaps.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const entries = metadataToUrlEntries(
    buildMarketingChromeEntries({ siteUrl: site }),
  );
  // 1h browser cache + 2h CDN cache — marketing chrome doesn't change
  // multiple times per day.
  return xmlResponse(renderSitemap(entries), 3600);
}
