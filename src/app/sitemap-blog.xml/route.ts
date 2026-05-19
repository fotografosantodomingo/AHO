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
 * GET /sitemap-blog.xml — programmatic-SEO blog URL set.
 *
 * Two buckets:
 *   1. The /blog INDEX page per locale (7 locales × hreflang map).
 *   2. Per-published-post URLs. For each `translation_group_id`,
 *      every published sibling row contributes ONE URL, and ALL
 *      siblings appear as `<xhtml:link rel="alternate">` entries on
 *      each other's <url> — that's Google's reciprocal-hreflang
 *      requirement for multilingual content.
 *
 * Empty-platform behavior: index page entry still ships even when
 * zero posts are published; the index page itself renders a clean
 * empty state. Master `/sitemap.xml` conditionally includes this
 * child only when ≥1 published row exists.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('blog_posts')
    .select('slug, language, published_at, updated_at, translation_group_id')
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
    translation_group_id: string;
  }>;

  const entries: UrlEntry[] = [];

  // ─── Index page entry, per locale via hreflang map ───────────────
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

  // ─── Group rows by translation_group_id ───────────────────────────
  // Each group emits N <url> entries, one per language, where each
  // entry's `alternates` map carries the OTHER languages' URLs (incl.
  // self) for proper reciprocal hreflang.
  const groups = new Map<
    string,
    Array<{ slug: string; language: string; lastmod: Date | undefined }>
  >();
  for (const r of rows) {
    if (!(LOCALES as readonly string[]).includes(r.language)) continue;
    const lastmodSource = r.updated_at ?? r.published_at;
    const lastmod = lastmodSource ? new Date(lastmodSource) : undefined;
    const existing = groups.get(r.translation_group_id) ?? [];
    existing.push({ slug: r.slug, language: r.language, lastmod });
    groups.set(r.translation_group_id, existing);
  }

  for (const [, siblings] of groups) {
    // Build the alternates map ONCE per group — every sibling URL
    // shares the same map.
    const alternates: Record<string, string> = {};
    for (const s of siblings) {
      alternates[s.language] = `${site}/${s.language}/blog/${s.slug}`;
    }
    const enSibling = siblings.find((s) => s.language === 'en');
    if (enSibling) alternates['x-default'] = `${site}/en/blog/${enSibling.slug}`;

    for (const s of siblings) {
      entries.push({
        loc: `${site}/${s.language}/blog/${s.slug}`,
        lastmod: s.lastmod,
        alternates,
        changefreq: 'monthly',
        priority: 0.7,
      });
    }
  }

  return xmlResponse(renderSitemap(entries), 3600);
}
