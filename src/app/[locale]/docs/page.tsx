/**
 * Documentation hub — written guide for buyers, agents, and admins.
 *
 * Three top-level sections, each navigable via the table-of-contents
 * sidebar. All copy lives in `messages/{locale}.json` under the `docs`
 * namespace. Links inside each section reference real surfaces inside
 * the product; the `href` value in messages is a short stable key that
 * we map here to the right per-locale URL (mirrors the same per-locale
 * slug records used in `src/components/footer/site-footer.tsx`).
 *
 * Per CLAUDE.md hard rule #8: this page deliberately describes screens
 * in words rather than embedding screenshots. There are no fake
 * screenshots, no fake testimonials, no fake stats. Empty-state copy is
 * honest emptiness ("really empty," "we don't seed demo X").
 *
 * Server component. The table-of-contents sidebar uses anchor links
 * only (no JS); on mobile each top-level section can be collapsed via
 * a `<details>` element so the page stays scannable without scripting.
 */
import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localeUrl } from '@/lib/seo/sitemap-helpers';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

interface PageParams {
  locale: string;
}

/**
 * Map of doc-link href keys → builder of the localized URL. Each
 * builder takes a locale and returns the leading-slash absolute path
 * (e.g. `/es/buscar`). Keys must match the `href` values used in the
 * `docs.*.sections[].links[]` arrays in messages.
 *
 * Some hrefs are static across locales (`/admin`, `/setup-mfa`); some
 * are per-locale slugs (`/search` ↔ `/buscar`). The rest are EN-only
 * for the v1 marketing locales — those locales currently fall back to
 * the EN slug per `src/i18n/config.ts` (`en5(...)` helper), so the
 * value returned here matches the actual URL the link will resolve to.
 */
const HREF_BUILDERS: Record<string, (locale: Locale) => string> = {
  search: (l) => `/${l}/${l === 'es' ? 'buscar' : 'search'}`,
  countries: (l) => `/${l}/${l === 'es' ? 'paises' : 'countries'}`,
  pricing: (l) => `/${l}/${l === 'es' ? 'precios' : 'pricing'}`,
  privacy: (l) => `/${l}/${l === 'es' ? 'privacidad' : 'privacy'}`,
  terms: (l) => `/${l}/${l === 'es' ? 'terminos' : 'terms'}`,
  signin: (l) => `/${l}/${l === 'es' ? 'iniciar-sesion' : 'signin'}`,
  signup: (l) => `/${l}/${l === 'es' ? 'registrarse' : 'signup'}`,
  'saved-properties': (l) =>
    `/${l}/${l === 'es' ? 'inmuebles-guardados' : 'saved-properties'}`,
  'saved-searches': (l) =>
    `/${l}/${l === 'es' ? 'busquedas-guardadas' : 'saved-searches'}`,
  onboarding: (l) =>
    `/${l}/${l === 'es' ? 'inicio/bienvenida' : 'onboarding/welcome'}`,
  dashboard: (l) => `/${l}/${l === 'es' ? 'panel' : 'dashboard'}`,
  'dashboard-properties': (l) =>
    `/${l}/${l === 'es' ? 'panel/propiedades' : 'dashboard/properties'}`,
  'dashboard-new-property': (l) =>
    `/${l}/${l === 'es' ? 'panel/propiedades/nuevo' : 'dashboard/properties/new'}`,
  'dashboard-leads': (l) =>
    `/${l}/${l === 'es' ? 'panel/contactos' : 'dashboard/leads'}`,
  'dashboard-leads-routing': (l) =>
    `/${l}/${l === 'es' ? 'panel/contactos/enrutamiento' : 'dashboard/leads/routing'}`,
  'dashboard-analytics': (l) =>
    `/${l}/${l === 'es' ? 'panel/estadisticas' : 'dashboard/analytics'}`,
  'dashboard-social': (l) =>
    `/${l}/${l === 'es' ? 'panel/social' : 'dashboard/social'}`,
  'dashboard-profile': (l) =>
    `/${l}/${l === 'es' ? 'panel/perfil' : 'dashboard/profile'}`,
  'dashboard-reviews': (l) =>
    `/${l}/${l === 'es' ? 'panel/resenas' : 'dashboard/reviews'}`,
  'setup-mfa': (l) => `/${l}/setup-mfa`,
  admin: () => `/admin`,
};

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const typedLocale = locale as Locale;
  const t = await getTranslations({ locale, namespace: 'docs' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();

  const languages: Record<string, string> = {};
  for (const l of LOCALES) {
    languages[l] = localeUrl({ siteUrl: site, locale: l, pathKey: '/docs' });
  }
  languages['x-default'] = languages.en ?? '';

  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: {
      canonical: localeUrl({ siteUrl: site, locale: typedLocale, pathKey: '/docs' }),
      languages,
    },
    openGraph: {
      type: 'article',
      url: localeUrl({ siteUrl: site, locale: typedLocale, pathKey: '/docs' }),
      title: t('meta.title'),
      description: t('meta.description'),
    },
    robots: { index: true, follow: true },
  };
}

interface DocLink {
  label: string;
  href: string;
}

interface DocSection {
  id: string;
  title: string;
  body: string[];
  links: DocLink[];
}

interface DocAudience {
  heading: string;
  intro: string;
  sections: DocSection[];
}

export default async function DocsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'docs' });

  const audiences: Array<{ key: 'buyers' | 'agents' | 'admins'; data: DocAudience }> = [
    { key: 'buyers', data: t.raw('buyers') as DocAudience },
    { key: 'agents', data: t.raw('agents') as DocAudience },
    { key: 'admins', data: t.raw('admins') as DocAudience },
  ];

  // Resolve the localized URL for a doc link's `href` key. Falls back
  // to a no-op anchor (`#`) if a content author references a key we
  // haven't wired here yet — the link still renders so the omission is
  // visible in QA, but we don't 500 the whole page over a missing
  // builder.
  const resolveHref = (key: string): string => {
    const builder = HREF_BUILDERS[key];
    return builder ? builder(typedLocale) : '#';
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <header className="mx-auto max-w-3xl">
        <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-4xl">
          {t('heading')}
        </h1>
        <p className="mt-3 text-sm text-helper">{t('lastUpdated')}</p>
        <p className="mt-4 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
          {t('intro')}
        </p>
      </header>

      <div className="mt-12 grid gap-12 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10">
        {/* Sticky table of contents on md+; collapsible on mobile via
            <details> so the page stays scannable without JS. */}
        <aside className="md:sticky md:top-24 md:self-start">
          <details className="md:open" open>
            <summary className="cursor-pointer font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-ink md:cursor-default md:list-none dark:text-ink-inverse">
              {t('toc.heading')}
            </summary>
            <nav aria-label={t('toc.heading')} className="mt-3 space-y-1 text-sm">
              {audiences.map(({ key, data }) => (
                <div key={key}>
                  <a
                    href={`#${key}`}
                    className="block py-1 text-ink-muted underline-offset-2 hover:underline dark:text-ink-inverse-muted"
                  >
                    {data.heading}
                  </a>
                  <ul className="ml-3 space-y-0.5 border-l border-black/10 pl-3 dark:border-white/10">
                    {data.sections.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          className="block py-1 text-xs text-ink-muted underline-offset-2 hover:underline dark:text-ink-inverse-muted"
                        >
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </details>
        </aside>

        <div className="space-y-16">
          {audiences.map(({ key, data }) => (
            <section
              key={key}
              id={key}
              className="scroll-mt-24"
              aria-labelledby={`${key}-heading`}
            >
              <h2
                id={`${key}-heading`}
                className="font-brand text-2xl font-semibold tracking-tight md:text-3xl"
              >
                {data.heading}
              </h2>
              <p className="mt-3 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                {data.intro}
              </p>

              <div className="mt-8 space-y-10">
                {data.sections.map((section) => (
                  <article
                    key={section.id}
                    id={section.id}
                    className="scroll-mt-24"
                  >
                    <h3 className="font-brand text-lg font-semibold tracking-tight md:text-xl">
                      {section.title}
                    </h3>
                    <div className="mt-3 space-y-3 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                      {section.body.map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                      ))}
                    </div>
                    {section.links.length > 0 && (
                      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                        {section.links.map((link) => (
                          <li key={`${section.id}-${link.href}`}>
                            <a
                              href={resolveHref(link.href)}
                              className="text-action underline-offset-2 hover:underline dark:text-action-dark"
                            >
                              {link.label}
                              <span aria-hidden="true"> →</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
