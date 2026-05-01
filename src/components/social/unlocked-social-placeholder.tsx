import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';

interface Props {
  locale: Locale;
}

/**
 * Placeholder for Pro Automation users on `/dashboard/social` until
 * Phase 4 (OAuth) lands. They've paid for the unlock; they shouldn't
 * see the locked-state upsell — they should see "you have it,
 * coming online soon."
 *
 * Replaced by the real connected-accounts UI in Phase 4 of the
 * social-distribution spec.
 */
export async function UnlockedSocialPlaceholder({ locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'social' });

  return (
    <section
      aria-labelledby="unlocked-social-heading"
      className="rounded-card border border-action/30 bg-action/5 p-6 shadow-whisper"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-action">
        {t('unlockedEyebrow')}
      </p>
      <h2
        id="unlocked-social-heading"
        className="mt-1 font-brand text-2xl font-semibold tracking-tight md:text-[28px]"
      >
        {t('unlockedHeading')}
      </h2>
      <p className="mt-2 text-sm text-ink-muted">{t('unlockedBody')}</p>
      <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
        {(
          ['rolloutOauth', 'rolloutPreview', 'rolloutPosting', 'rolloutHistory'] as const
        ).map((key) => (
          <li key={key} className="flex items-start gap-2 text-ink-muted">
            <span aria-hidden="true" className="mt-0.5 text-action">
              →
            </span>
            <span>{t(`rollout.${key}` as 'rollout.rolloutOauth')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
