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

// End-of-article Free Audit CTA. The blog is the top-of-funnel
// distribution surface (cron auto-publishes daily across 7 locales);
// the funnel was leaking because there was zero conversion path from
// "agent reads article on Google" to "agent tries the product." This
// section converts the read into a Free Audit click — the same wedge
// /for-agents uses, so the agent's journey is read → try → sign up.
// One copy per locale: per-market voice matters here as much as in
// the article body itself.
const FREE_AUDIT_CTA: Record<
  Locale,
  { eyebrow: string; headline: string; body: string; button: string; ariaLabel: string }
> = {
  en: {
    eyebrow: 'Free in 60 seconds',
    headline: 'Try this on your own listing',
    body: 'Paste your listing URL — get 9 ad captions + 3 graphics ready to publish on Facebook, Instagram, and LinkedIn. No signup to see the preview.',
    button: 'Get my free audit',
    ariaLabel: 'Free Audit call to action',
  },
  es: {
    eyebrow: 'Gratis en 60 segundos',
    headline: 'Pruébalo con tu propio anuncio',
    body: 'Pega la URL de tu propiedad — obtén 9 textos publicitarios + 3 gráficos listos para publicar en Facebook, Instagram y LinkedIn. Sin registro para ver la vista previa.',
    button: 'Obtener mi auditoría gratis',
    ariaLabel: 'Llamada a la acción de auditoría gratis',
  },
  pl: {
    eyebrow: 'Bezpłatnie w 60 sekund',
    headline: 'Wypróbuj to na własnej ofercie',
    body: 'Wklej URL swojej oferty — otrzymasz 9 tekstów reklamowych + 3 grafiki gotowe do publikacji na Facebooku, Instagramie i LinkedIn. Bez rejestracji do podglądu.',
    button: 'Pobierz mój bezpłatny audyt',
    ariaLabel: 'Wezwanie do bezpłatnego audytu',
  },
  pt: {
    eyebrow: 'Grátis em 60 segundos',
    headline: 'Experimente no seu próprio anúncio',
    body: 'Cole o URL do seu anúncio — obtenha 9 textos publicitários + 3 gráficos prontos para publicar no Facebook, Instagram e LinkedIn. Sem registo para ver a pré-visualização.',
    button: 'Obter a minha auditoria grátis',
    ariaLabel: 'Chamada para auditoria grátis',
  },
  de: {
    eyebrow: 'Kostenlos in 60 Sekunden',
    headline: 'Testen Sie es mit Ihrem eigenen Inserat',
    body: 'Inserat-URL einfügen — Sie erhalten 9 Anzeigentexte + 3 Grafiken, bereit zur Veröffentlichung auf Facebook, Instagram und LinkedIn. Kein Login für die Vorschau erforderlich.',
    button: 'Meinen kostenlosen Audit holen',
    ariaLabel: 'Kostenlose Audit-Handlungsaufforderung',
  },
  fr: {
    eyebrow: 'Gratuit en 60 secondes',
    headline: 'Essayez sur votre propre annonce',
    body: 'Collez l’URL de votre annonce — recevez 9 textes publicitaires + 3 visuels prêts à publier sur Facebook, Instagram et LinkedIn. Sans inscription pour voir l’aperçu.',
    button: 'Obtenir mon audit gratuit',
    ariaLabel: 'Appel à l’action d’audit gratuit',
  },
  it: {
    eyebrow: 'Gratis in 60 secondi',
    headline: 'Provalo sul tuo annuncio',
    body: 'Incolla l’URL del tuo annuncio — ottieni 9 testi pubblicitari + 3 grafiche pronte da pubblicare su Facebook, Instagram e LinkedIn. Nessuna registrazione per vedere l’anteprima.',
    button: 'Ottieni il mio audit gratuito',
    ariaLabel: 'Invito all’azione per audit gratuito',
  },
};

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

  const cta = FREE_AUDIT_CTA[typedLocale] ?? FREE_AUDIT_CTA.en;
  const forAgentsHref = localePath(typedLocale, '/for-agents');

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
        <aside
          aria-label={cta.ariaLabel}
          className="aho-blog-cta mt-12 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 md:p-8"
        >
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            {cta.eyebrow}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">
            {cta.headline}
          </h2>
          <p className="mt-3 text-base text-slate-700 md:text-lg">{cta.body}</p>
          <div className="mt-6">
            <a
              href={`/${typedLocale}${forAgentsHref}#free-audit`}
              className="inline-flex items-center rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700"
            >
              {cta.button} →
            </a>
          </div>
        </aside>
      </main>
    </>
  );
}
