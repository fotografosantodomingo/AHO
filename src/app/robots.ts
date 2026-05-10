import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * AHO robots.txt — surfaced at `/robots.txt` via Next.js's metadata-route
 * convention.
 *
 * Allow rules:
 *   - Public marketing + property pages: indexable.
 *
 * Disallow rules:
 *   - `/dashboard/*`, `/panel/*`         — agent dashboards (auth-gated; no SEO value)
 *   - `/api/*`, `/auth/*`                — programmatic surfaces
 *   - `/onboarding/*`, `/inicio/*`        — Stripe-return pages, also noindex'd
 *   - `/search`, `/buscar`               — faceted URLs cause infinite crawl
 *                                          (per HANDOFF.md §16.7); city
 *                                          landing pages serve as the
 *                                          indexable browse alternative
 *                                          once they ship.
 *
 * Sitemap is referenced explicitly so search engines can find it without
 * relying on a stray `<link>` in `<head>`.
 */
export default function robots(): MetadataRoute.Robots {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: [
          '/api/',
          '/auth/',
          '/dashboard/',
          '/panel/',
          '/onboarding/',
          '/inicio/',
          '/en/search',
          '/es/buscar',
          // Internal moderation surface — auth-gated by is_admin flag,
          // but we also tell crawlers explicitly to stay out so the URL
          // doesn't show up in any indexed snippet. Includes all /admin
          // sub-paths (orgs, leads, etc.) via the trailing slash.
          '/en/admin/',
          '/es/admin/',
        ],
      },
    ],
    // Single sitemap-index entry — crawlers fetch the index once and
    // traverse to every child sitemap (URL sitemap + image sitemap
    // today; per-locale or per-resource splits when inventory grows
    // past ~30K URLs and the URL sitemap nears the 50K-URL cap). This
    // is the canonical entry point per sitemaps.org § "Using sitemap
    // index files". The individual sitemaps remain reachable directly
    // (`/sitemap.xml`, `/sitemap-images.xml`) so existing inbound
    // references and Search Console submissions don't break.
    sitemap: [`${site}/sitemap-index.xml`],
    host: site,
  };
}
