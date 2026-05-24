import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { LandingPage, type LandingCopy } from '@/components/marketing/landing-page';
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
  const t = await getTranslations({ locale, namespace: 'saveTime' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/save-time',
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

export default async function SaveTimePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'saveTime' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/save-time',
    currentLocale: typedLocale,
    siteUrl: site,
  });

  const pricingHref = localePath(typedLocale, '/pricing');
  const pricingFocusHref = `${pricingHref}?focus=pro_automation`;

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
    solution: { heading: t('solution.heading'), body: t('solution.body') },
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
  };

  const homeUrl = `${site}/${typedLocale}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: tNav('home'),
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
    name: 'AHO Pro Automation — save time on listings',
    serviceType: 'Real estate listing automation',
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
      url: `${site}${pricingFocusHref}`,
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

  // Single @graph: BreadcrumbList + Service + Product + FAQPage.
  const pageGraph = buildGraph([
    breadcrumbJsonLd as JsonLdNode,
    serviceJsonLd as JsonLdNode,
    productJsonLd as JsonLdNode,
    faqJsonLd as JsonLdNode,
  ]);

  return (
    <>
      <JsonLd node={pageGraph} />
      <LandingPage
        copy={copy}
        primaryCtaHref={pricingFocusHref}
        secondaryCtaHref={pricingHref}
        pricingCtaHref={pricingFocusHref}
      />
    </>
  );
}
