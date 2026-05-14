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
 * /[locale]/profile-guide — Profile-SEO manual for agents.
 *
 * Companion to /share-guide. Explains how each AHO profile field maps
 * to a Schema.org property Google reads (RealEstateAgent + sameAs +
 * knowsAbout + knowsLanguage + FAQPage + aggregateRating). The
 * structured-data emit is already automatic; this page tells the
 * agent which form fields they need to fill to make that structured
 * data actually useful for ranking.
 *
 * Linked from /share-guide (cross-link CTA inserted 2026-05-14).
 * CTA at the bottom goes to /dashboard/profile (action, not subscribe
 * — most agents reading this already pay $29 Agent or $99 Pro Auto).
 *
 * 7-locale fully-translated copy. Same hreflang shape as the other
 * agent-acquisition landings.
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
  const t = await getTranslations({ locale, namespace: 'agentProfileGuide' });
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const alts = buildLandingAlternates({
    pathKey: '/profile-guide',
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

export default async function ProfileGuidePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'agentProfileGuide' });
  const profileEditorHref = localePath(typedLocale, '/dashboard/profile');

  const fields = [
    { titleKey: 'field1Title', bodyKey: 'field1Body' },
    { titleKey: 'field2Title', bodyKey: 'field2Body' },
    { titleKey: 'field3Title', bodyKey: 'field3Body' },
    { titleKey: 'field4Title', bodyKey: 'field4Body' },
    { titleKey: 'field5Title', bodyKey: 'field5Body' },
    { titleKey: 'field6Title', bodyKey: 'field6Body' },
    { titleKey: 'field7Title', bodyKey: 'field7Body' },
    { titleKey: 'field8Title', bodyKey: 'field8Body' },
  ] as const;

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

      {/* Intro — what we emit to Google */}
      <section className="mb-12 rounded-card border border-border bg-surface-muted/50 p-6 dark:border-border-strong/40 dark:bg-surface-dark/40 md:mb-16 md:p-8">
        <h2 className="font-brand text-xl font-semibold tracking-tight md:text-2xl">
          {t('introHeading')}
        </h2>
        <p className="mt-3 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
          {t('introBody')}
        </p>
      </section>

      {/* Checklist */}
      <section className="mb-12 md:mb-16">
        <h2 className="mb-6 font-brand text-2xl font-semibold tracking-tight md:text-[28px]">
          {t('checklistHeading')}
        </h2>
        <ol className="space-y-5">
          {fields.map(({ titleKey, bodyKey }) => (
            <li
              key={titleKey}
              className="rounded-card border border-border bg-surface p-5 shadow-whisper dark:border-border-strong/40 dark:bg-surface-deep"
            >
              <h3 className="font-brand text-lg font-semibold tracking-tight text-ink dark:text-ink-inverse">
                {t(titleKey as 'field1Title')}
              </h3>
              <p className="mt-2 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                {t(bodyKey as 'field1Body')}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* What happens when you publish */}
      <section className="mb-12 md:mb-16">
        <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[28px]">
          {t('publishHeading')}
        </h2>
        <ul className="mt-4 space-y-3">
          {['publish1', 'publish2', 'publish3'].map((key) => (
            <li
              key={key}
              className="flex items-start gap-3 text-base leading-relaxed text-ink-muted dark:text-ink-inverse-muted"
            >
              <span
                aria-hidden="true"
                className="mt-1 text-action dark:text-action-dark"
              >
                →
              </span>
              <span>{t(key as 'publish1')}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Reviews + FAQ side-by-side on desktop */}
      <section className="mb-12 grid gap-4 md:mb-16 md:grid-cols-2">
        <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-5">
          <p className="font-brand text-sm font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            ★ {t('reviewsHeading')}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
            {t('reviewsBody')}
          </p>
        </div>
        <div className="rounded-card border border-action/30 bg-action/5 p-5 dark:border-action-dark/30 dark:bg-action-dark/10">
          <p className="font-brand text-sm font-semibold uppercase tracking-wider text-action dark:text-action-dark">
            ? {t('faqHeading')}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-ink dark:text-ink-inverse">
            {t('faqBody')}
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section
        aria-labelledby="profile-guide-cta"
        className="rounded-card border border-action/30 bg-action/5 p-8 text-center shadow-whisper dark:border-action-dark/30 dark:bg-action-dark/10 md:p-12"
      >
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
          {t('ctaEyebrow')}
        </p>
        <h2
          id="profile-guide-cta"
          className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-[32px]"
        >
          {t('ctaHeading')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('ctaSub')}
        </p>
        <div className="mt-6">
          <Link
            href={profileEditorHref}
            className="btn-primary inline-flex h-12 items-center px-8 text-base font-semibold"
          >
            {t('ctaButton')} →
          </Link>
        </div>
      </section>
    </main>
  );
}
