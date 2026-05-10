import { publicEnv } from '@/lib/env';
import { MARKETING_LASTMOD } from '@/lib/seo/sitemap-helpers';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Sitemap index — surfaced at `/sitemap-index.xml`.
 *
 * Per the sitemaps.org protocol, an index is just a `<sitemapindex>`
 * document that lists child sitemap URLs. Crawlers fetch the index
 * once, then queue each child sitemap independently. With two child
 * sitemaps today (URL sitemap + image sitemap) the index is mainly
 * future-proofing — when listings cross ~30K URLs we'll split the URL
 * sitemap into per-locale or per-resource children, and only this
 * file's `sitemaps` array changes.
 *
 * `lastmod` on each child entry tells the crawler whether to re-fetch
 * that child. We use:
 *   - `MARKETING_LASTMOD` for the URL sitemap (its content depends on
 *     listing data, but the lastmod *of the index entry itself* is
 *     just "when did we last touch the sitemap composition logic").
 *     The per-URL lastmods inside the child sitemap are what actually
 *     drive Google's crawl prioritisation for individual pages.
 *   - `new Date()` for the image sitemap so crawlers re-pull whenever
 *     a fresh request hits the index — image uploads happen at any
 *     hour and we want photos in image search promptly.
 *
 * Hand-built XML (not Next.js's `generateSitemaps()`) for the same
 * reason as `/sitemap-images.xml`: the typed sitemap-index API
 * requires Node runtime, which Cloudflare Pages doesn't run.
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const now = new Date();

  const children = [
    { loc: `${site}/sitemap.xml`, lastmod: MARKETING_LASTMOD.toISOString() },
    { loc: `${site}/sitemap-images.xml`, lastmod: now.toISOString() },
  ];

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const child of children) {
    lines.push('  <sitemap>');
    lines.push(`    <loc>${escapeXml(child.loc)}</loc>`);
    lines.push(`    <lastmod>${escapeXml(child.lastmod)}</lastmod>`);
    lines.push('  </sitemap>');
  }
  lines.push('</sitemapindex>');

  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=600',
    },
  });
}
