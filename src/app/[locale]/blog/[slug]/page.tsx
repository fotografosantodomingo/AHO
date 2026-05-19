import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  buildBlogPosting,
  buildBreadcrumbList,
  buildGraph,
} from '@/lib/seo/jsonld';

/**
 * /blog/[slug] — public blog post page.
 *
 * Renders `body_html` straight from the DB via dangerouslySetInnerHTML.
 * The HTML was sanitized at write-time by `validateBlogHtml()` in
 * `src/lib/blog/html-validate.ts`:
 *   - No Microdata attributes (itemprop / itemscope / itemtype)
 *   - Breadcrumb <nav> + ToC <nav> + author bio <aside> all present
 *   - Every ToC anchor maps to an actual <h2 id> / <h3 id>
 * Because we never persist user-submitted HTML here (only AI output
 * that we ourselves validated), the dangerouslySetInnerHTML usage is
 * acceptable. Per CLAUDE.md hard rule #8 the content itself is real
 * editorial (real byline + real reviewed-at date), not fake data.
 */

export const runtime = 'edge';
// Render on each request (the page reads the post by slug from
// Supabase). CDN-level caching is set via Cache-Control headers in
// `next.config.ts:headers()` for the /blog/* pattern; CF Pages picks
// up the header and caches the rendered HTML at the edge so
// subsequent readers get a <100ms response from the closest POP.
// Article content is static once published — only the cron writes
// new rows, and even an edit hits the row's `updated_at` which
// busts any per-row cache the future may want.
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
  slug: string;
}

interface BlogPostRow {
  slug: string;
  title: string;
  summary: string;
  body_html: string;
  hero_image_url: string | null;
  language: string;
  author_name: string;
  author_role: string;
  author_url: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  word_count: number;
  published_at: string;
  updated_at: string;
  translation_group_id: string;
}

interface SiblingRow {
  slug: string;
  language: string;
}

async function loadPost(slug: string, locale: string): Promise<BlogPostRow | null> {
  const admin = createAdminClient();
  // Filter by language AND slug — prevents `/es/blog/<en-slug>`
  // rendering EN content inside the ES shell.
  const { data, error } = await admin
    .from('blog_posts')
    .select(
      'slug, title, summary, body_html, hero_image_url, language, author_name, author_role, author_url, reviewer_name, reviewed_at, word_count, published_at, updated_at, translation_group_id',
    )
    .eq('slug', slug)
    .eq('language', locale)
    .eq('status', 'published')
    .maybeSingle();
  if (error) {
    console.error('[/blog/[slug]] load failed', {
      slug,
      locale,
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return (data as unknown as BlogPostRow) ?? null;
}

/**
 * Returns each sibling translation in the group (including the row
 * itself). Used by both generateMetadata (hreflang alternates) and
 * the page body (JSON-LD BreadcrumbList — currently doesn't need
 * siblings, but kept for future "Read in <lang>" UI).
 */
async function loadSiblings(translationGroupId: string): Promise<SiblingRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('blog_posts')
    .select('slug, language')
    .eq('translation_group_id', translationGroupId)
    .eq('status', 'published');
  if (error) {
    console.error('[/blog/[slug]] siblings load failed', {
      translationGroupId,
      code: error.code,
      message: error.message,
    });
    return [];
  }
  return (data as unknown as SiblingRow[]) ?? [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const typedLocale = locale as Locale;
  const post = await loadPost(slug, typedLocale);
  if (!post) return {};
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const canonical = `${site}${localePath(typedLocale, `/blog/${slug}`)}`;

  // Hreflang alternates — walk siblings in the translation group and
  // emit one href per locale (incl. self). This is Google's reciprocal-
  // hreflang requirement for multilingual content.
  const siblings = await loadSiblings(post.translation_group_id);
  const languages: Record<string, string> = {};
  for (const s of siblings) {
    if (!LOCALES.includes(s.language as Locale)) continue;
    languages[s.language] = `${site}/${s.language}/blog/${s.slug}`;
  }
  // x-default points at the EN sibling if present, otherwise the
  // canonical for this locale.
  const enSibling = siblings.find((s) => s.language === 'en');
  if (enSibling) languages['x-default'] = `${site}/en/blog/${enSibling.slug}`;

  return {
    title: `${post.title} — AHO Blog`,
    description: post.summary,
    alternates: { canonical, languages },
    openGraph: {
      type: 'article',
      url: canonical,
      title: post.title,
      description: post.summary,
      ...(post.hero_image_url ? { images: [post.hero_image_url] } : {}),
      publishedTime: post.published_at,
      modifiedTime: post.updated_at,
      authors: [post.author_name],
      locale: typedLocale,
    },
    robots: { index: true, follow: true },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const post = await loadPost(slug, typedLocale);
  if (!post) notFound();

  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const url = `${site}${localePath(typedLocale, `/blog/${slug}`)}`;
  const homeUrl = `${site}/${typedLocale}`;
  const blogIndexUrl = `${site}${localePath(typedLocale, '/blog')}`;

  const graph = buildGraph([
    buildBlogPosting({
      url,
      headline: post.title,
      description: post.summary,
      image: post.hero_image_url,
      datePublished: post.published_at,
      dateModified: post.updated_at,
      inLanguage: post.language,
      author: {
        name: post.author_name,
        url: post.author_url,
        jobTitle: post.author_role,
      },
      reviewer: post.reviewer_name ? { name: post.reviewer_name } : null,
      publisher: {
        name: 'AHO — Advertise Homes Online',
        url: site,
        logoUrl: `${site}/logo-512.png`,
      },
      wordCount: post.word_count,
    }),
    buildBreadcrumbList([
      { name: typedLocale === 'es' ? 'Inicio' : 'Home', url: homeUrl },
      { name: typedLocale === 'es' ? 'Blog' : 'Blog', url: blogIndexUrl },
      { name: post.title, url },
    ]),
  ]);

  return (
    <>
      <JsonLd node={graph} />
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <article
          // body_html is AI-generated content that passed
          // validateBlogHtml() at write-time — no user input, no
          // Microdata, no <script>. The page-render path here is the
          // single rendering surface for that sanitized blob.
          className="aho-blog-prose"
          dangerouslySetInnerHTML={{ __html: post.body_html }}
        />
      </main>
    </>
  );
}
