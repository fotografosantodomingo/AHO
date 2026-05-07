import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import { LockedSocialModule } from '@/components/social/locked-social-module';
import { UnlockedSocialPlaceholder } from '@/components/social/unlocked-social-placeholder';
import { ConnectMetaSection } from '@/components/social/connect-meta-section';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const KNOWN_FLASH_STATUSES = [
  'connected',
  'denied',
  'invalid',
  'state_mismatch',
  'exchange_failed',
  'long_lived_failed',
  'fetch_failed',
] as const;
type FlashStatus = (typeof KNOWN_FLASH_STATUSES)[number];

/**
 * /{locale}/dashboard/social
 *
 * Phase 1 — plan-gated landing page for the Social Media Automation
 * feature. Two states:
 *
 *   Pro Automation user → unlocked placeholder ("rolling out soon")
 *   Lower-tier user     → locked module + upgrade CTA
 *
 * Future: Phase 4 replaces the unlocked placeholder with the real
 * connected-accounts UI; Phase 5 adds the post-preview modal; Phase 6
 * adds the posting engine + history.
 *
 * Auth + org membership enforced by the dashboard layout.
 */
export default async function SocialDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'social' });
  const tNav = await getTranslations({ locale, namespace: 'dashboard' });

  const supabase = await createServerSupabaseClient();
  const ctx = await getCurrentUserOrgPlan(supabase);
  const unlocked = ctx
    ? await isOrgOnProAutomation(supabase, ctx.orgId)
    : false;

  // Parse the OAuth callback's flash payload for the Connect section.
  const sp = await searchParams;
  const rawStatus = typeof sp.meta_oauth === 'string' ? sp.meta_oauth : null;
  const flashStatus: FlashStatus | null =
    rawStatus && (KNOWN_FLASH_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as FlashStatus)
      : null;
  const flash = flashStatus
    ? {
        status: flashStatus,
        pages:
          typeof sp.pages === 'string' ? Number(sp.pages) || 0 : undefined,
        ig: typeof sp.ig === 'string' ? Number(sp.ig) || 0 : undefined,
        reason: typeof sp.reason === 'string' ? sp.reason : undefined,
      }
    : undefined;

  return (
    <main className="space-y-6">
      <header>
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {tNav('navSocial')}
        </p>
        <h1 className="mt-1 font-brand text-2xl font-semibold tracking-tight md:text-[32px] md:leading-[1.15]">
          {t('pageHeading')}
        </h1>
        <p className="mt-1 text-sm text-helper">{t('pageSubheading')}</p>
      </header>

      {unlocked ? (
        <>
          <ConnectMetaSection locale={typedLocale} flash={flash} />
          <UnlockedSocialPlaceholder locale={typedLocale} />
        </>
      ) : (
        <LockedSocialModule locale={typedLocale} size="full" />
      )}
    </main>
  );
}
