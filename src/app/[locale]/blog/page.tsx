import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  buildBreadcrumbList,
  buildCollectionPage,
  buildGraph,
} from '@/lib/seo/jsonld';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const PAGE_LIMIT = 30;

interface PageParams {
  locale: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const typedLocale = locale as Locale;
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/blog',
    currentLocale: typedLocale,
    siteUrl: site,
  });
  const title =
    typedLocale === 'es'
      ? 'Blog de AHO — Marketing inmobiliario multi-canal'
      : 'AHO Blog — Multi-channel real-estate marketing';
  const description =
    typedLocale === 'es'
      ? 'Cómo agentes y propietarios privados compiten con los portales y Facebook Marketplace usando distribución multi-canal.'
      : 'How agents and private sellers compete with portals and Facebook Marketplace using multi-channel distribution.';
  return {
    title,
    description,
    alternates: { canonical: alts.canonical, languages: alts.languages },
    openGraph: { type: 'website', url: alts.canonical, title, description },
    robots: { index: true, follow: true },
  };
}

interface BlogIndexRow {
  slug: string;
  title: string;
  summary: string;
  published_at: string;
  word_count: number;
  language: string;
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);
  const tBlog = await getTranslations({ locale: typedLocale, namespace: 'blog' });

  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/blog',
    currentLocale: typedLocale,
    siteUrl: site,
  });

  // Edge-runtime safe: admin client used for read because blog_posts
  // policy allows anon SELECT on `status='published'` and we want the
  // public view independent of any session cookie state.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('blog_posts')
    .select('slug, title, summary, published_at, word_count, language')
    .eq('status', 'published')
    // Each locale (en/es/pl/pt/de/fr/it) reads its own translated
    // siblings — translation pipeline lands one row per locale per
    // post. Pre-2026-05-19 only en + es had real rows; pl/pt/de/fr/it
    // fell back to en. Now every locale has its own row.
    .eq('language', typedLocale)
    .order('published_at', { ascending: false })
    .limit(PAGE_LIMIT);
  if (error) {
    console.error('[/blog] list query failed', {
      code: error.code,
      message: error.message,
    });
  }
  const rows = (data ?? []) as unknown as BlogIndexRow[];

  const heading = tBlog('indexHeading');
  const tagline = tBlog('indexTagline');
  const emptyLabel = tBlog('empty');
  const readingMinLabel = (mins: number) => tBlog('readingMin', { count: mins });

  // JSON-LD: CollectionPage + BreadcrumbList.
  const homeUrl = `${site}/${typedLocale}`;
  const graph = buildGraph([
    buildCollectionPage({
      name: heading,
      url: alts.canonical,
      description: tagline,
      inLanguage: typedLocale,
    }),
    buildBreadcrumbList([
      { name: tBlog('breadcrumbHome'), url: homeUrl },
      { name: heading, url: alts.canonical },
    ]),
  ]);

  return (
    <>
      <JsonLd node={graph} />
      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <header className="mb-10">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            AHO
          </p>
          <h1 className="mt-2 font-brand text-3xl font-semibold tracking-tight md:text-5xl">
            {heading}
          </h1>
          <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted md:text-lg">
            {tagline}
          </p>
        </header>

        {rows.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong/60 bg-surface p-8 text-center text-sm text-helper">
            {emptyLabel}
          </p>
        ) : (
          <ul className="space-y-6">
            {rows.map((post) => {
              const href = localePath(typedLocale, `/blog/${post.slug}`);
              const readingMin = Math.max(2, Math.round(post.word_count / 220));
              const dateLabel = post.published_at
                ? new Date(post.published_at).toISOString().slice(0, 10)
                : '';
              return (
                <li
                  key={post.slug}
                  className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep"
                >
                  <Link
                    href={href}
                    className="font-brand text-xl font-semibold tracking-tight hover:underline md:text-2xl"
                  >
                    {post.title}
                  </Link>
                  <p className="mt-1 text-xs text-helper">
                    {dateLabel} · {readingMinLabel(readingMin)}
                  </p>
                  <p className="mt-3 text-sm text-ink-muted dark:text-ink-inverse-muted">
                    {post.summary}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
