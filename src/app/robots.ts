import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { LOCALES, PATHNAMES } from '@/i18n/config';

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
 *   - `/{locale}/{search-segment}`        — faceted URLs cause infinite
 *                                          crawl (per HANDOFF.md §16.7);
 *                                          city landing pages are the
 *                                          indexable browse alternative.
 *                                          Generated from LOCALES so all
 *                                          7 locales (EN/ES + marketing
 *                                          PL/PT/DE/FR/IT) are covered —
 *                                          previously only EN+ES were
 *                                          listed and the marketing
 *                                          locales' /search loops were
 *                                          crawled (QA-2026-05-10 P0 #5).
 *   - `/{locale}/admin/`                  — internal moderation surface;
 *                                          auth-gated by is_admin but we
 *                                          also tell crawlers to stay out
 *                                          so the URL never leaks via
 *                                          SERP snippets.
 *
 * Sitemap is referenced explicitly so search engines can find it without
 * relying on a stray `<link>` in `<head>`.
 */
export default function robots(): MetadataRoute.Robots {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();

  // Per-locale search segment: ES uses /buscar, every other locale uses
  // /search (per PATHNAMES). Read from the table rather than hardcode
  // so a future segment translation lands in robots.txt for free.
  const searchEntry = PATHNAMES['/search'];
  const searchPaths = LOCALES.map((locale) => {
    const segment =
      typeof searchEntry === 'string' ? searchEntry : searchEntry[locale];
    return `/${locale}${segment}`;
  });
  const adminPaths = LOCALES.map((locale) => `/${locale}/admin/`);

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
          ...searchPaths,
          ...adminPaths,
        ],
      },
    ],
    // Canonical entry point per sitemaps.org § "Using sitemap index
    // files". `/sitemap.xml` IS the master index (refactored 2026-05-14);
    // it lists 6 sub-sitemaps (pages / landings / properties / agents /
    // locations / images). Each sub-sitemap is independently fetched by
    // crawlers, so adding one listing only bumps the freshness signal
    // for /sitemap-properties.xml instead of the entire URL set.
    sitemap: [`${site}/sitemap.xml`],
    host: site,
  };
}
