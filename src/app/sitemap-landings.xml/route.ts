import { publicEnv } from '@/lib/env';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';
import {
  MARKETING_LASTMOD,
  renderSitemap,
  xmlResponse,
  type UrlEntry,
} from '@/lib/seo/sitemap-helpers';

export const runtime = 'edge';

/**
 * GET /sitemap-landings.xml — agent-acquisition landings only:
 * /for-agents, /automation, /save-time, each × 7 locales = 21 URLs.
 *
 * These are conversion-funnel pages distinct from the marketing chrome:
 * crawlers learn faster about a new locale variant when the surface
 * sits in its own sitemap. Lastmod is `MARKETING_LASTMOD` (constant).
 *
 * Part of the sitemap-index split shipped 2026-05-14.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const pathKeys = [
    '/for-agents',
    '/automation',
    '/save-time',
    '/share-guide',
  ] as const;
  const entries: UrlEntry[] = [];
  for (const pathKey of pathKeys) {
    const alts = buildLandingAlternates({
      pathKey,
      currentLocale: 'en',
      siteUrl: site,
    });
    for (const { url } of alts.allUrls) {
      entries.push({
        loc: url,
        lastmod: MARKETING_LASTMOD,
        changefreq: 'weekly',
        priority: 0.8,
        alternates: alts.languages,
      });
    }
  }
  return xmlResponse(renderSitemap(entries), 3600);
}
