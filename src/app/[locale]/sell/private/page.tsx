import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  buildBreadcrumbList,
  buildFAQPage,
  buildGraph,
  buildProduct,
  buildWebPage,
  type JsonLdNode,
} from '@/lib/seo/jsonld';
import { PayNowButton } from '@/components/sell/pay-now-button';

export const runtime = 'edge';
export const dynamic = 'force-static';

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
  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/sell/private',
    currentLocale: typedLocale,
    siteUrl: site,
  });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: { canonical: alts.canonical, languages: alts.languages },
    openGraph: {
      type: 'website',
      url: alts.canonical,
      title: t('meta.title'),
      description: t('meta.description'),
    },
    robots: { index: true, follow: true },
  };
}

interface FaqItem {
  q: string;
  a: string;
}

interface StepItem {
  title: string;
  body: string;
}

export default async function SellPrivateLandingPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'sellPrivate' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/sell/private',
    currentLocale: typedLocale,
    siteUrl: site,
  });

  const steps = t.raw('process.steps') as StepItem[];
  const includedItems = t.raw('included.items') as string[];
  const excludedItems = t.raw('excluded.items') as string[];
  const faqItems = t.raw('faq.items') as FaqItem[];

  const pricingHref = localePath(typedLocale, '/pricing');
  const homeUrl = `${site}/${typedLocale}`;
  const sellUrl = `${site}${localePath(typedLocale, '/sell')}`;

  // JSON-LD: single @graph with WebPage + Product + Offer + FAQPage + BreadcrumbList.
  const breadcrumb = buildBreadcrumbList([
    { name: typedLocale === 'es' ? 'Inicio' : 'Home', url: homeUrl },
    {
      name: typedLocale === 'es' ? 'Vender' : 'Sell',
      url: sellUrl,
    },
    {
      name: t('hero.eyebrow'),
      url: alts.canonical,
    },
  ]);

  const webPage = buildWebPage({
    name: t('meta.title'),
    url: alts.canonical,
    description: t('meta.description'),
    inLanguage: typedLocale,
  });

  const product = buildProduct({
    name: t('hero.heading'),
    description: t('meta.description'),
    url: alts.canonical,
    brand: 'AHO',
    offers: [
      {
        price: '5.00',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock',
        url: alts.canonical,
        description:
          typedLocale === 'es'
            ? 'Anuncio único de 60 días — pago único, sin suscripción'
            : 'Single 60-day listing — one-time payment, no subscription',
      },
    ],
  });

  const faq = buildFAQPage({
    url: alts.canonical,
    entries: faqItems.map((f) => ({ q: f.q, a: f.a })),
  });

  const graph = buildGraph([
    webPage as JsonLdNode,
    product as JsonLdNode,
    faq as JsonLdNode,
    breadcrumb as JsonLdNode,
  ]);

  return (
    <>
      <JsonLd node={graph} />
      <main className="mx-auto max-w-5xl px-4 py-12 md:py-16">
        {/* ─── Hero ───────────────────────────────────────────── */}
        <section
          aria-labelledby="sell-private-hero"
          className="rounded-card border border-border bg-surface px-6 py-12 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:px-12 md:py-16"
        >
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
            {t('hero.eyebrow')}
          </p>
          <h1
            id="sell-private-hero"
            className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-5xl"
          >
            {t('hero.heading')}
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-ink-muted dark:text-ink-inverse-muted md:text-xl">
            {t('hero.sub')}
          </p>
          <div className="mt-8">
            <PayNowButton label={t('hero.cta')} />
          </div>
        </section>

        {/* ─── 5-step process ─────────────────────────────────── */}
        <section
          aria-labelledby="sell-private-process"
          className="mt-16 md:mt-24"
        >
          <h2
            id="sell-private-process"
            className="font-brand text-2xl font-semibold tracking-tight md:text-3xl"
          >
            {t('process.heading')}
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, idx) => (
              <li
                key={idx}
                className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-action/10 font-brand text-base font-semibold text-action dark:bg-action-dark/15 dark:text-action-dark"
                >
                  {idx + 1}
                </span>
                <h3 className="mt-4 font-brand text-lg font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm text-ink-muted dark:text-ink-inverse-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {/* ─── Included + Excluded (side-by-side on md+) ─────── */}
        <section
          aria-labelledby="sell-private-coverage"
          className="mt-16 grid gap-8 md:mt-24 md:grid-cols-2"
        >
          <h2 id="sell-private-coverage" className="sr-only">
            {typedLocale === 'es' ? 'Cobertura del plan' : 'Plan coverage'}
          </h2>

          <div className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-8">
            <h3 className="font-brand text-xl font-semibold tracking-tight">
              {t('included.heading')}
            </h3>
            <ul className="mt-4 space-y-3">
              {includedItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-8">
            <h3 className="font-brand text-xl font-semibold tracking-tight">
              {t('excluded.heading')}
            </h3>
            <ul className="mt-4 space-y-3">
              {excludedItems.map((item, idx) => (
                <li key={idx} className="flex items-start gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted dark:bg-surface-dark dark:text-ink-inverse-muted"
                  >
                    ×
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link
              href={pricingHref}
              className="mt-6 inline-flex text-sm font-medium text-action underline-offset-4 hover:underline dark:text-action-dark"
            >
              {t('excluded.upgradeCta')}
            </Link>
          </div>
        </section>

        {/* ─── FAQ ────────────────────────────────────────────── */}
        <section aria-labelledby="sell-private-faq" className="mt-16 md:mt-24">
          <h2
            id="sell-private-faq"
            className="font-brand text-2xl font-semibold tracking-tight md:text-3xl"
          >
            {t('faq.heading')}
          </h2>
          {/* Plain <details> accordion — Agent 1's FaqAccordion has
              not landed in this branch yet, so we render the simpler
              native disclosure. Same JSON-LD FAQPage payload is
              already emitted above, so SEO is unaffected. */}
          <div className="mt-8 space-y-3">
            {faqItems.map((item, idx) => (
              <details
                key={idx}
                className="group rounded-card border border-border bg-surface p-5 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep"
              >
                <summary className="flex cursor-pointer items-start justify-between gap-3 font-brand text-base font-medium tracking-tight">
                  <span>{item.q}</span>
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-block transition-transform group-open:rotate-180"
                  >
                    ▾
                  </span>
                </summary>
                <p className="mt-3 text-sm text-ink-muted dark:text-ink-inverse-muted">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* ─── Repeat CTA ─────────────────────────────────────── */}
        <section
          aria-labelledby="sell-private-cta-repeat"
          className="mt-16 rounded-card border border-border bg-surface px-6 py-12 text-center shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:mt-24 md:px-12 md:py-16"
        >
          <h2
            id="sell-private-cta-repeat"
            className="font-brand text-2xl font-semibold tracking-tight md:text-3xl"
          >
            {t('ctaRepeat.heading')}
          </h2>
          <div className="mt-6 flex justify-center">
            <PayNowButton label={t('ctaRepeat.button')} />
          </div>
        </section>
      </main>
    </>
  );
}
