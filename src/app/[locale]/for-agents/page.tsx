import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { LandingPage, type LandingCopy } from '@/components/marketing/landing-page';
import { FreeAuditWidget } from '@/components/marketing/free-audit-widget';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';
import { publicEnv } from '@/lib/env';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildGraph, type JsonLdNode } from '@/lib/seo/jsonld';

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
  const t = await getTranslations({ locale, namespace: 'forAgents' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/for-agents',
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

export default async function ForAgentsPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'forAgents' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/for-agents',
    currentLocale: typedLocale,
    siteUrl: site,
  });

  // Conversion-focused routing for /for-agents:
  //   - primary + final CTAs → /signup (start free trial)
  //   - hero secondary CTA   → #vision anchor (scroll to "How it works")
  //   - pricing teaser CTA   → /pricing?focus=pro_automation (full plan compare)
  // Per the Content Hub Vision page brief: top-of-funnel conversion is the
  // free-trial signup, not the pricing-page deep-link. Pricing teaser still
  // hands off to /pricing for visitors who need the full plan comparison.
  const pricingFocusHref = `${localePath(typedLocale, '/pricing')}?focus=pro_automation`;
  const signupHref = localePath(typedLocale, '/signup');
  const visionAnchor = '#vision';

  const copy: LandingCopy = {
    hero: {
      eyebrow: t('hero.eyebrow'),
      headline: t('hero.headline'),
      sub: t('hero.sub'),
      primaryCta: t('hero.primaryCta'),
      secondaryCta: t('hero.secondaryCta'),
    },
    problem: {
      heading: t('problem.heading'),
      bullets: t.raw('problem.bullets') as string[],
    },
    solution: {
      heading: t('solution.heading'),
      body: t('solution.body'),
    },
    features: {
      heading: t('features.heading'),
      items: t.raw('features.items') as Array<{ title: string; body: string }>,
    },
    howItWorks: {
      heading: t('howItWorks.heading'),
      steps: t.raw('howItWorks.steps') as Array<{ title: string; body: string }>,
    },
    pricingTeaser: {
      eyebrow: t('pricingTeaser.eyebrow'),
      price: t('pricingTeaser.price'),
      period: t('pricingTeaser.period'),
      features: t.raw('pricingTeaser.features') as string[],
      cta: t('pricingTeaser.cta'),
    },
    faq: {
      heading: t('faq.heading'),
      items: t.raw('faq.items') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      heading: t('finalCta.heading'),
      sub: t('finalCta.sub'),
      cta: t('finalCta.cta'),
    },
    trustStrip: {
      heading: t('trustStrip.heading'),
      items: t.raw('trustStrip.items') as Array<{ label: string; detail: string }>,
    },
  };

  // ─── JSON-LD bundle ────────────────────────────────────────────
  // Service + Offer + Product nodes, plus BreadcrumbList + FAQPage.
  // Each emitted as a separate script so each rich-result type
  // tracks its own validity in Google's eyes.

  const homeUrl = `${site}/${typedLocale}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: typedLocale === 'es' ? 'Inicio' : 'Home',
        item: homeUrl,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: t('hero.eyebrow'),
        item: alts.canonical,
      },
    ],
  };

  const serviceJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'AHO Pro Automation',
    serviceType: 'Real estate listing distribution and social automation',
    provider: {
      '@type': 'Organization',
      name: 'AHO — Advertise Homes Online',
      url: site,
    },
    areaServed: 'Worldwide',
    description: t('meta.description'),
    offers: {
      '@type': 'Offer',
      price: '99',
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price: '99',
        priceCurrency: 'USD',
        unitCode: 'MON',
      },
      availability: 'https://schema.org/InStock',
      url: pricingFocusHref,
    },
  };

  const productJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'AHO Pro Automation',
    description: t('meta.description'),
    brand: { '@type': 'Brand', name: 'AHO' },
    offers: {
      '@type': 'Offer',
      price: '99',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${site}${pricingFocusHref}`,
    },
  };

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.faq.items.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };

  // Single @graph: BreadcrumbList + Service + Product + FAQPage. Each
  // node references the site-wide Organization/WebSite via @id (those
  // live in [locale]/layout.tsx).
  const pageGraph = buildGraph([
    breadcrumbJsonLd as JsonLdNode,
    serviceJsonLd as JsonLdNode,
    productJsonLd as JsonLdNode,
    faqJsonLd as JsonLdNode,
  ]);

  return (
    <>
      <JsonLd node={pageGraph} />
      {/* Free Audit widget — Phase 1 wedge of
          docs/SUPER_PRO_STAGE_1_PLAN.md. Renders ABOVE the static
          landing page so the cold visitor sees "paste your URL" as
          the first interactive element, not after scrolling past
          the marketing hero. The widget is interactive (client),
          everything below stays server-rendered. */}
      <div id="free-audit" className="scroll-mt-20">
        <FreeAuditWidget />
      </div>
      <LandingPage
        copy={copy}
        primaryCtaHref={signupHref}
        secondaryCtaHref={visionAnchor}
        pricingCtaHref={pricingFocusHref}
      />
      <ShareGuideCta locale={typedLocale} />
    </>
  );
}

/**
 * Standalone CTA appended below the main LandingPage. Drives agents
 * to the step-by-step manual at /[locale]/share-guide before they
 * subscribe — so they know exactly what they're paying for. Added
 * 2026-05-14 per PO directive (separate page with simple end-to-end
 * instructions).
 *
 * Uses translations from the `forAgents.manualCta` namespace which
 * was added alongside the new /share-guide page. All 7 locales.
 */
async function ShareGuideCta({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'forAgents.manualCta' });
  const guideHref = localePath(locale, '/share-guide');
  return (
    <section
      aria-labelledby="for-agents-manual-cta"
      className="mx-auto max-w-3xl px-4 pb-16 pt-8 md:pb-24"
    >
      <div className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-10">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
          {t('eyebrow')}
        </p>
        <h2
          id="for-agents-manual-cta"
          className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-[32px]"
        >
          {t('heading')}
        </h2>
        <p className="mt-3 text-base text-ink-muted dark:text-ink-inverse-muted md:text-lg">
          {t('body')}
        </p>
        <div className="mt-6">
          <Link
            href={guideHref}
            className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
          >
            {t('cta')} →
          </Link>
        </div>
      </div>
    </section>
  );
}
