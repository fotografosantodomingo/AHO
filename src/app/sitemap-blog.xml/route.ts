import { publicEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  renderSitemap,
  xmlResponse,
  type UrlEntry,
} from '@/lib/seo/sitemap-helpers';
import { LOCALES } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /sitemap-blog.xml — programmatic SEO blog index + per-post URLs.
 *
 * Three buckets emitted:
 *   1. The /blog index page, per locale (7 locales × hreflang map).
 *   2. Each published post at /blog/<slug>, one URL per row.
 *
 * Empty-platform behavior: when zero posts are published the route
 * still emits the index page entry per locale (the index page itself
 * renders an "empty" state, not an error) but no per-post URLs.
 *
 * Master sitemap (`/sitemap.xml`) conditionally includes this child
 * only when ≥1 published post exists — same convention as the
 * properties + agents children. See `/sitemap.xml/route.ts` for the
 * gating logic.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const admin = createAdminClient();

  // Posts ordered newest-first so the freshest URLs sit at the top of
  // the sitemap (Google biases crawl priority by position).
  const { data, error } = await admin
    .from('blog_posts')
    .select('slug, language, published_at, updated_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (error) {
    console.error('[/sitemap-blog.xml] query failed', {
      code: error.code,
      message: error.message,
    });
  }

  const rows = (data ?? []) as Array<{
    slug: string;
    language: string;
    published_at: string | null;
    updated_at: string | null;
  }>;

  const entries: UrlEntry[] = [];

  // Index page — one entry, with all locales as hreflang alternates.
  const indexAlternates: Record<string, string> = {};
  for (const loc of LOCALES) {
    indexAlternates[loc] = `${site}${localePath(loc, '/blog')}`;
  }
  indexAlternates['x-default'] = `${site}${localePath('en', '/blog')}`;
  entries.push({
    loc: `${site}${localePath('en', '/blog')}`,
    alternates: indexAlternates,
    changefreq: 'daily',
    priority: 0.6,
  });

  // Per-post entries. v1 ships English-only posts; ES/PL/PT/DE/FR/IT
  // posts will populate as soon as a translation pass runs. The
  // language column tells us which locale to render the canonical URL
  // under — we don't multiply per locale here since we don't have
  // translations.
  for (const row of rows) {
    const lastmodSource = row.updated_at ?? row.published_at;
    const lastmod = lastmodSource ? new Date(lastmodSource) : undefined;
    // Map the row's language to a Locale safely.
    const lang = (LOCALES as readonly string[]).includes(row.language)
      ? (row.language as (typeof LOCALES)[number])
      : 'en';
    entries.push({
      loc: `${site}${localePath(lang, `/blog/${row.slug}`)}`,
      lastmod,
      changefreq: 'monthly',
      priority: 0.7,
    });
  }

  // 1h browser cache + bumps when a post publishes (master index
  // controls re-crawl; this file's lastmod follows post writes).
  return xmlResponse(renderSitemap(entries), 3600);
}
