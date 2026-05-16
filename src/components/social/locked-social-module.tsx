import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

interface Props {
  locale: Locale;
  /** When 'compact', renders a smaller card suitable for inline placement
   *  on /dashboard/properties/[id] alongside other actions. When 'full',
   *  renders the full-page locked view used at /dashboard/social. */
  size?: 'compact' | 'full';
}

/**
 * Locked-state UI for the Social Media Automation feature
 * (feat/pro-automation-social-distribution, Phase 1).
 *
 * Visible to ALL paid users, but only INTERACTIVE on Pro Automation.
 * Lower-tier users (Agent / Plus) see this module with a clear value
 * proposition + "Upgrade to Pro Automation" CTA pointing at /pricing.
 *
 * The intentional product-design choice (per docs/social media…rtf
 * "feature visible to lower plans, locked with upgrade CTA"): showing
 * the locked UI is constant-but-quiet upsell. Users see the feature
 * sitting there every time they edit a listing → far higher upgrade
 * conversion than email-only nudges.
 *
 * RULE (per spec): "Buttons disabled. Backend 403 on attempt." — this
 * component renders the disabled CTAs; the API routes enforce 403.
 */
export async function LockedSocialModule({ locale, size = 'full' }: Props) {
  const t = await getTranslations({ locale, namespace: 'social' });
  // Focus the pricing page on the Pro Automation tier — the user is
  // looking AT the social dashboard, comparing 3 tiers would be noise.
  const pricingHref = `${localePath(locale, '/pricing')}?focus=pro_automation`;

  const headingClass =
    size === 'full'
      ? 'font-brand text-2xl font-semibold tracking-tight md:text-[28px]'
      : 'font-brand text-lg font-semibold tracking-tight';

  return (
    <section
      aria-labelledby="locked-social-heading"
      className="rounded-card border border-border bg-surface p-6 shadow-whisper"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent"
        >
          {/* Lock glyph — small, brass on cream */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">
            {t('lockedEyebrow')}
          </p>
          <h2 id="locked-social-heading" className={`${headingClass} mt-1`}>
            {t('lockedHeading')}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {t('lockedBody')}
          </p>
        </div>
      </div>

      {/* Disabled platform pills — visual placeholder for what unlocks. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {(['facebook', 'instagram', 'linkedin'] as const).map((platform) => (
          <span
            key={platform}
            aria-disabled="true"
            className="inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full border border-border-strong/40 bg-surface-muted/60 px-3 text-sm font-medium text-ink-muted"
          >
            <svg
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-3.5 w-3.5"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {t(`platform.${platform}` as 'platform.facebook')}
          </span>
        ))}
      </div>

      {size === 'full' && (
        <ul className="mt-6 grid gap-2 text-sm md:grid-cols-2">
          {(
            ['featAi', 'featImages', 'featLinks', 'featHistory'] as const
          ).map((key) => (
            <li key={key} className="flex items-start gap-2 text-ink-muted">
              <span aria-hidden="true" className="mt-0.5 text-action">
                ✓
              </span>
              <span>{t(`features.${key}` as 'features.featAi')}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link href={pricingHref} className="btn-primary">
          {t('upgradeCta')}
        </Link>
        <span className="text-xs text-helper">{t('upgradeNote')}</span>
      </div>
    </section>
  );
}
