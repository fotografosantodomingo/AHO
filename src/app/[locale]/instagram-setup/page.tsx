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
 * /[locale]/instagram-setup — Phase 2 of docs/INSTAGRAM_SHARING_PLAN.md.
 *
 * Self-serve guide for agents who hit the "no Instagram detected"
 * nudge on /dashboard/social. The infrastructure for IG publishing
 * is ALREADY built (publishToInstagramBusiness, OAuth callback IG
 * token storage, ShareToSocials UI); the gap is per-agent: the
 * agent must link their IG Business account to a Facebook Page in
 * Meta Business Suite before AHO can see it.
 *
 * This page walks them through that linking in 4 numbered steps,
 * plus a troubleshooting panel for the most common failure modes.
 * Linked from connect-meta-section.tsx's amber callout.
 *
 * Routes: /instagram-setup (EN/PL/PT/DE/FR/IT), /configurar-instagram (ES).
 * Static generation — content is locale-stable, no per-request data.
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
  const t = await getTranslations({ locale, namespace: 'instagramSetup' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/instagram-setup',
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

export default async function InstagramSetupPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'instagramSetup' });
  const socialHref = localePath(typedLocale, '/dashboard/social');

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 md:py-16">
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

      {/* Why-it-works frame — set expectations before the steps */}
      <section className="mb-12 rounded-card border border-border bg-surface-muted/50 p-5 dark:border-border-strong/40 dark:bg-surface-dark/40">
        <p className="font-semibold text-ink dark:text-ink-inverse">
          {t('whyHeading')}
        </p>
        <p className="mt-2 text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('whyBody')}
        </p>
      </section>

      {/* Step 1 — Switch IG to Business / Creator */}
      <Step number={t('step1Number')} title={t('step1Title')}>
        <p>{t('step1Body')}</p>
        <ul className="mt-3 space-y-2 text-sm">
          {['step1A', 'step1B', 'step1C', 'step1D', 'step1E'].map((key) => (
            <li
              key={key}
              className="flex items-start gap-2 text-ink-muted dark:text-ink-inverse-muted"
            >
              <span aria-hidden="true" className="mt-0.5 text-action dark:text-action-dark">→</span>
              <span>{t(key as 'step1A')}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm italic text-helper">{t('step1Note')}</p>
      </Step>

      {/* Step 2 — Link IG to FB Page in Meta Business Suite */}
      <Step number={t('step2Number')} title={t('step2Title')}>
        <p>{t('step2Body')}</p>
        <ul className="mt-3 space-y-2 text-sm">
          {['step2A', 'step2B', 'step2C', 'step2D', 'step2E'].map((key) => (
            <li
              key={key}
              className="flex items-start gap-2 text-ink-muted dark:text-ink-inverse-muted"
            >
              <span aria-hidden="true" className="mt-0.5 text-action dark:text-action-dark">→</span>
              <span>{t(key as 'step2A')}</span>
            </li>
          ))}
        </ul>
        <p className="pt-3">
          <a
            href="https://business.facebook.com/settings/instagram-accounts"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
          >
            {t('step2Cta')} ↗
          </a>
        </p>
      </Step>

      {/* Step 3 — Reconnect on AHO */}
      <Step number={t('step3Number')} title={t('step3Title')}>
        <p>{t('step3Body')}</p>
        <p className="pt-3">
          <Link
            href={socialHref}
            className="btn-primary inline-flex h-10 items-center px-5 text-sm font-semibold"
          >
            {t('step3Cta')} →
          </Link>
        </p>
      </Step>

      {/* Step 4 — Verify */}
      <Step number={t('step4Number')} title={t('step4Title')}>
        <p>{t('step4Body')}</p>
        <div className="mt-4 rounded-card border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">
            ✓ {t('successHeading')}
          </p>
          <p className="mt-2 text-emerald-900 dark:text-emerald-100">
            {t('successBody')}
          </p>
        </div>
      </Step>

      {/* Troubleshooting panel — the 3 most common failure modes */}
      <section className="mt-12 rounded-card border border-amber-500/30 bg-amber-500/5 p-6">
        <p className="font-brand text-sm font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-200">
          {t('troubleHeading')}
        </p>
        <dl className="mt-4 space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n}>
              <dt className="font-semibold text-amber-900 dark:text-amber-100">
                {t(`trouble${n}Q` as 'trouble1Q')}
              </dt>
              <dd className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                {t(`trouble${n}A` as 'trouble1A')}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Final CTA */}
      <section className="mt-12 rounded-card border border-action/30 bg-action/5 p-6 text-center dark:border-action-dark/30 dark:bg-action-dark/10">
        <p className="font-brand text-xl font-semibold tracking-tight">
          {t('finalHeading')}
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('finalBody')}
        </p>
        <div className="mt-5">
          <Link
            href={socialHref}
            className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold"
          >
            {t('finalCta')} →
          </Link>
        </div>
      </section>
    </main>
  );
}

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
