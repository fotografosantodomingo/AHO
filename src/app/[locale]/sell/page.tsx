/**
 * `/sell` — identity-selection landing page.
 *
 * Per docs/SELL_FUNNEL_PLAN.md (Track B): the missing intermediate
 * layer between the homepage and `/pricing`. Visitors land here from
 * the header "Sell" link and self-route into one of two flows:
 *
 *   - Homeowner / Landlord → `/sell/private` ($5 one-time listing)
 *   - Professional Agent   → `/pricing` ($29–$99/mo subscription)
 *
 * Server component, edge runtime, force-static. No client JS — the
 * FAQ uses native `<details>` for progressive enhancement and the
 * AHO Assistant widget mounts globally via `[locale]/layout.tsx`.
 *
 * Sections in order: Hero · Identity cards · How-it-works (split per
 * role) · Trust strip · Tier comparison · FAQ · Repeat-CTA. JSON-LD
 * emits one `@graph` (WebPage + Service + FAQPage + BreadcrumbList).
 *
 * Marketing locales (PL/PT/DE/FR/IT) fall back to EN copy via the
 * `messages/*.json` merge in `src/i18n/request.ts`; only EN + ES are
 * fully translated for the `sell.*` namespace.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { TierComparison, type TierComparisonRow } from '@/components/marketing/tier-comparison';
import { FaqAccordion } from '@/components/marketing/faq-accordion';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import {
  buildBreadcrumbList,
  buildFAQPage,
  buildGraph,
  buildService,
  buildWebPage,
} from '@/lib/seo/jsonld';

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
  const t = await getTranslations({ locale, namespace: 'sell' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/sell',
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

export default async function SellPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'sell' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/sell',
    currentLocale: typedLocale,
    siteUrl: site,
  });

  const privateHref = localePath(typedLocale, '/sell/private');
  const pricingHref = localePath(typedLocale, '/pricing');
  const homeUrl = `${site}/${typedLocale}`;

  // ─── Strongly-typed copy reads ────────────────────────────────────
  const cardPrivateBullets = t.raw('cardPrivate.bullets') as string[];
  const cardPrivateIncludes = t.raw('cardPrivate.includes') as string[];
  const cardAgentBullets = t.raw('cardAgent.bullets') as string[];
  const cardAgentIncludes = t.raw('cardAgent.includes') as string[];
  const howPrivateSteps = t.raw('how.private.steps') as string[];
  const howAgentSteps = t.raw('how.agent.steps') as string[];
  const trustPills = t.raw('trust.pills') as string[];
  const compareRows = t.raw('compare.rows') as TierComparisonRow[];
  const faqItems = t.raw('faq.items') as Array<{ q: string; a: string }>;

  // ─── JSON-LD bundle ───────────────────────────────────────────────
  // Single @graph: WebPage + Service + FAQPage + BreadcrumbList.
  const breadcrumbNode = buildBreadcrumbList([
    { name: typedLocale === 'es' ? 'Inicio' : 'Home', url: homeUrl },
    { name: t('hero.eyebrow'), url: alts.canonical },
  ]);
  const webPageNode = buildWebPage({
    name: t('meta.title'),
    url: alts.canonical,
    description: t('meta.description'),
    inLanguage: typedLocale,
  });
  const serviceNode = buildService({
    name: 'AHO — Advertise Homes Online',
    description: t('meta.description'),
    url: alts.canonical,
    areaServed: 'Worldwide',
    serviceType: 'Real estate listing distribution and social automation',
    offers: [
      {
        price: '5',
        priceCurrency: 'USD',
        description: t('cardPrivate.price'),
        url: `${site}${privateHref}`,
      },
      {
        price: '29',
        priceCurrency: 'USD',
        description: t('cardAgent.priceNote'),
        url: `${site}${pricingHref}`,
      },
    ],
  });
  const faqNode = buildFAQPage({
    url: alts.canonical,
    entries: faqItems,
  });
  const pageGraph = buildGraph([
    webPageNode,
    serviceNode,
    faqNode,
    breadcrumbNode,
  ]);

  return (
    <>
      <JsonLd node={pageGraph} />
      <main>
        {/* ───── Hero ───── */}
        <section className="relative overflow-hidden border-b border-border">
          <DotGrid />
          <HeroGlow />
          <div className="relative mx-auto max-w-5xl px-6 py-20 text-center md:py-28">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {t('hero.eyebrow')}
            </p>
            <h1 className="mx-auto mt-3 max-w-3xl font-brand text-[34px] font-semibold leading-[1.1] tracking-tight md:text-[56px] md:leading-[1.07]">
              {t('hero.heading')}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-ink-muted md:text-lg dark:text-ink-inverse-muted">
              {t('hero.sub')}
            </p>
          </div>
        </section>

        {/* ───── Identity cards ───── */}
        <section
          aria-labelledby="sell-identity-heading"
          className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30"
        >
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <h2
              id="sell-identity-heading"
              className="text-center font-brand text-2xl font-semibold tracking-tight md:text-3xl"
            >
              {t('identity.heading')}
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              {/* Private / Homeowner card */}
              <article className="flex h-full flex-col rounded-card border border-border bg-surface p-7 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-8">
                <HomeIcon />
                <p className="mt-4 font-brand text-[12px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('cardPrivate.tag')}
                </p>
                <h3 className="mt-1 font-brand text-2xl font-semibold tracking-tight md:text-[28px]">
                  {t('cardPrivate.heading')}
                </h3>
                <div className="mt-5">
                  <p className="text-sm font-semibold tracking-tight">
                    {t('cardPrivate.perfectFor')}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {cardPrivateBullets.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-action dark:bg-action-dark"
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-5">
                  <p className="text-sm font-semibold tracking-tight">
                    {t('cardPrivate.includesLabel')}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {cardPrivateIncludes.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
                      >
                        <CheckIcon />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6 rounded-md border border-border bg-surface-band/60 px-4 py-3 dark:border-border-strong/30 dark:bg-surface-deep/60">
                  <p className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
                    {t('cardPrivate.price')}
                  </p>
                  <p className="mt-1 text-xs text-helper">
                    {t('cardPrivate.priceNote')}
                  </p>
                </div>
                <Link
                  href={privateHref}
                  className="btn-primary mt-6 inline-flex h-12 items-center justify-center px-6 text-base font-semibold"
                >
                  {t('cardPrivate.cta')} →
                </Link>
              </article>

              {/* Agent card */}
              <article className="flex h-full flex-col rounded-card border-2 border-action bg-surface p-7 shadow-lift dark:border-action-dark dark:bg-surface-deep md:p-8">
                <BriefcaseIcon />
                <p className="mt-4 font-brand text-[12px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
                  {t('cardAgent.tag')}
                </p>
                <h3 className="mt-1 font-brand text-2xl font-semibold tracking-tight md:text-[28px]">
                  {t('cardAgent.heading')}
                </h3>
                <div className="mt-5">
                  <p className="text-sm font-semibold tracking-tight">
                    {t('cardPrivate.perfectFor')}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {cardAgentBullets.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
                      >
                        <span
                          aria-hidden="true"
                          className="mt-2 h-1 w-1 shrink-0 rounded-full bg-action dark:bg-action-dark"
                        />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-5">
                  <p className="text-sm font-semibold tracking-tight">
                    {t('cardPrivate.includesLabel')}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {cardAgentIncludes.map((b, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
                      >
                        <CheckIcon />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6 rounded-md border border-action/30 bg-action/5 px-4 py-3 dark:border-action-dark/40 dark:bg-action-dark/10">
                  <p className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
                    {t('cardAgent.priceNote')}
                  </p>
                </div>
                <Link
                  href={pricingHref}
                  className="btn-secondary mt-6 inline-flex h-12 items-center justify-center px-6 text-base font-semibold"
                >
                  {t('cardAgent.cta')} →
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* ───── How it works (split per role) ───── */}
        <section
          aria-labelledby="sell-how-heading"
          className="border-b border-border"
        >
          <div className="mx-auto max-w-6xl px-6 py-16 md:py-20">
            <h2
              id="sell-how-heading"
              className="text-center font-brand text-2xl font-semibold tracking-tight md:text-3xl"
            >
              {t('how.heading')}
            </h2>
            <div className="mt-10 grid gap-8 md:grid-cols-2">
              <div className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-8">
                <h3 className="font-brand text-lg font-semibold tracking-tight md:text-xl">
                  {t('how.private.title')}
                </h3>
                <ol className="mt-6 space-y-5">
                  {howPrivateSteps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-action/10 font-brand text-sm font-semibold text-action dark:bg-action-dark/15 dark:text-action-dark"
                      >
                        {i + 1}
                      </span>
                      <p className="pt-0.5 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                        {s}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-8">
                <h3 className="font-brand text-lg font-semibold tracking-tight md:text-xl">
                  {t('how.agent.title')}
                </h3>
                <ol className="mt-6 space-y-5">
                  {howAgentSteps.map((s, i) => (
                    <li key={i} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-action/10 font-brand text-sm font-semibold text-action dark:bg-action-dark/15 dark:text-action-dark"
                      >
                        {i + 1}
                      </span>
                      <p className="pt-0.5 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                        {s}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* ───── Trust strip ───── */}
        <TrustStrip pills={trustPills} realOnly={t('trust.realOnly')} />

        {/* ───── Comparison table ───── */}
        <TierComparison
          heading={t('compare.heading')}
          colPrivate={t('compare.colPrivate')}
          colAgent={t('compare.colAgent')}
          rows={compareRows}
        />

        {/* ───── FAQ ───── */}
        <FaqAccordion
          heading={t('faq.heading')}
          items={faqItems}
          headingId="sell-faq-heading"
        />

        {/* ───── Repeat CTA ───── */}
        <section className="border-b border-border bg-surface-band/40 dark:bg-surface-deep/30">
          <div className="mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
            <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-3xl">
              {t('cta.heading')}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-ink-muted dark:text-ink-inverse-muted">
              {t('cta.sub')}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={privateHref}
                className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
              >
                {t('cta.private')}
              </Link>
              <Link
                href={pricingHref}
                className="btn-secondary inline-flex h-12 items-center px-6 text-base font-semibold"
              >
                {t('cta.agent')}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

/* ─── Inline icons ─────────────────────────────────────────────────── */

function HomeIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-action dark:text-action-dark"
    >
      <path
        d="M3 11.5L12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-8.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-action dark:text-action-dark"
    >
      <rect
        x="3"
        y="7"
        width="18"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3 13h18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-action dark:text-action-dark"
    >
      <path
        d="M5 12.5L10 17l9-10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
