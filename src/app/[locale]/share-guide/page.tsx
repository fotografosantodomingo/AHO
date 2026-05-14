import type { Metadata } from 'next';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';
export const dynamic = 'force-static';

/**
 * /[locale]/share-guide — Agent quick-start manual.
 *
 * Step-by-step instructions for agents on Pro Automation: subscribe →
 * connect Facebook → publish a listing → click Share. Bilingual chrome
 * matches the same hreflang shape as /for-agents + /automation +
 * /save-time (7 fully-localized locales).
 *
 * Linked from /for-agents and (eventually) from the post-subscribe
 * welcome flow. Ends with a CTA to /pricing#pro_automation.
 *
 * Light + dark aware via the existing HashiCorp design tokens
 * (text-ink, bg-surface, etc.). No new tokens added.
 */

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
  const t = await getTranslations({ locale, namespace: 'agentGuide' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/share-guide',
    currentLocale: typedLocale,
    siteUrl: site,
  });
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
    alternates: { canonical: alts.canonical, languages: alts.languages },
    openGraph: {
      type: 'website',
      url: alts.canonical,
      title: t('metaTitle'),
      description: t('metaDescription'),
    },
    robots: { index: true, follow: true },
  };
}

export default async function ShareGuidePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'agentGuide' });
  const tProfileLink = await getTranslations({
    locale,
    namespace: 'agentGuide.profileLink',
  });
  const pricingHref = localePath(typedLocale, '/pricing') + '?focus=pro_automation';
  const profileGuideHref = localePath(typedLocale, '/profile-guide');

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
      {/* Hero */}
      <header className="mb-12 text-center md:mb-16">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
          {t('eyebrow')}
        </p>
        <h1 className="mt-2 font-brand text-3xl font-semibold leading-tight tracking-tight md:text-[44px] md:leading-[1.1]">
          {t('heading')}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted md:text-lg">
          {t('subheading')}
        </p>
      </header>

      {/* Step 1 */}
      <Step number={t('step1Number')} title={t('step1Title')}>
        <p>{t('step1Body')}</p>
        <p className="pt-2">
          <Link
            href={pricingHref}
            className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
          >
            {t('step1Cta')} →
          </Link>
        </p>
      </Step>

      {/* Step 2 */}
      <Step number={t('step2Number')} title={t('step2Title')}>
        <p>{t('step2Body')}</p>
        <div className="mt-4 rounded-card border border-border bg-surface-muted/50 p-4 text-sm dark:border-border-strong/40 dark:bg-surface-dark/40">
          <p className="font-semibold text-ink dark:text-ink-inverse">
            {t('step2WhatHeading')}
          </p>
          <ul className="mt-2 space-y-1.5">
            {['step2WhatP1', 'step2WhatP2', 'step2WhatP3', 'step2WhatP4'].map(
              (key) => (
                <li
                  key={key}
                  className="flex items-start gap-2 text-ink-muted dark:text-ink-inverse-muted"
                >
                  <span
                    aria-hidden="true"
                    className="mt-0.5 text-action dark:text-action-dark"
                  >
                    →
                  </span>
                  <span>{t(key as 'step2WhatP1')}</span>
                </li>
              ),
            )}
          </ul>
        </div>
      </Step>

      {/* Step 3 */}
      <Step number={t('step3Number')} title={t('step3Title')}>
        <p>{t('step3Body')}</p>
      </Step>

      {/* Step 4 */}
      <Step number={t('step4Number')} title={t('step4Title')}>
        <p>{t('step4Body')}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SubOption
            title={t('step4OptATitle')}
            body={t('step4OptABody')}
            color="action"
          />
          <SubOption
            title={t('step4OptBTitle')}
            body={t('step4OptBBody')}
            color="emerald"
          />
        </div>
      </Step>

      {/* Success + failure panels */}
      <section className="mt-12 grid gap-4 md:grid-cols-2">
        <div className="rounded-card border border-emerald-500/30 bg-emerald-500/5 p-5">
          <p className="font-brand text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            ✓ {t('successHeading')}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-emerald-900 dark:text-emerald-100">
            {['successP1', 'successP2', 'successP3'].map((key) => (
              <li key={key} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5">
                  →
                </span>
                <span>{t(key as 'successP1')}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-card border border-red-500/30 bg-red-500/5 p-5">
          <p className="font-brand text-sm font-semibold uppercase tracking-wider text-red-700 dark:text-red-300">
            ✗ {t('failureHeading')}
          </p>
          <ul className="mt-3 space-y-2 text-sm text-red-900 dark:text-red-100">
            {['failureP1', 'failureP2', 'failureP3', 'failureP4'].map((key) => (
              <li key={key} className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5">
                  →
                </span>
                <span>{t(key as 'failureP1')}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Cross-link to /profile-guide — "now optimize your profile for Google" */}
      <section
        aria-labelledby="share-guide-profile-link"
        className="mt-12 rounded-card border border-border bg-surface p-6 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep md:p-8"
      >
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
          {tProfileLink('eyebrow')}
        </p>
        <h2
          id="share-guide-profile-link"
          className="mt-2 font-brand text-xl font-semibold tracking-tight md:text-2xl"
        >
          {tProfileLink('heading')}
        </h2>
        <p className="mt-3 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
          {tProfileLink('body')}
        </p>
        <div className="mt-5">
          <Link
            href={profileGuideHref}
            className="inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface px-5 text-sm font-semibold transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
          >
            {tProfileLink('cta')} →
          </Link>
        </div>
      </section>

      {/* Bottom CTA */}
      <section
        aria-labelledby="share-guide-cta"
        className="mt-12 rounded-card border border-action/30 bg-action/5 p-8 text-center shadow-whisper dark:border-action-dark/30 dark:bg-action-dark/10 md:p-12"
      >
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
          {t('ctaEyebrow')}
        </p>
        <h2
          id="share-guide-cta"
          className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-[32px]"
        >
          {t('ctaHeading')}
        </h2>
        <p className="mt-3 font-brand text-4xl font-semibold text-ink dark:text-ink-inverse md:text-[44px]">
          {t('ctaPrice')}
        </p>
        <p className="mt-2 text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('ctaSub')}
        </p>
        <div className="mt-6">
          <Link
            href={pricingHref}
            className="btn-primary inline-flex h-12 items-center px-8 text-base font-semibold"
          >
            {t('ctaButton')} →
          </Link>
        </div>
      </section>
    </main>
  );
}

/** Numbered step block — number badge + title + body. */
function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12 md:mb-16">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="inline-flex h-8 items-center rounded-full border border-action/40 bg-action/10 px-3 font-brand text-xs font-semibold uppercase tracking-wider text-action dark:border-action-dark/40 dark:bg-action-dark/10 dark:text-action-dark">
          {number}
        </span>
        <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[28px]">
          {title}
        </h2>
      </div>
      <div className="mt-4 space-y-3 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
        {children}
      </div>
    </section>
  );
}

/** Sub-option card inside Step 4 (Generate AI draft / Share now). */
function SubOption({
  title,
  body,
  color,
}: {
  title: string;
  body: string;
  color: 'action' | 'emerald';
}) {
  const borderClass =
    color === 'action'
      ? 'border-action/30 bg-action/5 dark:border-action-dark/30 dark:bg-action-dark/10'
      : 'border-emerald-500/30 bg-emerald-500/5';
  const titleClass =
    color === 'action'
      ? 'text-action dark:text-action-dark'
      : 'text-emerald-700 dark:text-emerald-300';
  return (
    <div className={`rounded-card border p-4 ${borderClass}`}>
      <p className={`font-semibold ${titleClass}`}>{title}</p>
      <p className="mt-1 text-sm text-ink-muted dark:text-ink-inverse-muted">
        {body}
      </p>
    </div>
  );
}
