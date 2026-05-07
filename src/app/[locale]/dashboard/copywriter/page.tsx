import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import { LockedSocialModule } from '@/components/social/locked-social-module';
import { CopywriterPlayground } from '@/components/dashboard/copywriter-playground';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /{locale}/dashboard/copywriter
 *
 * Day-3 standalone playground for the AI Copywriter feature. Pro
 * Automation tier required. Lower tiers see the upgrade module.
 *
 * Future (post-Day-4): the Generate-captions button moves onto each
 * listing's edit page in the dashboard, pre-populating facts from the
 * DB. This page sticks around as the "free preview" hook for the
 * /for-agents acquisition funnel.
 */
export default async function CopywriterDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const supabase = await createServerSupabaseClient();
  const ctx = await getCurrentUserOrgPlan(supabase);
  const unlocked = ctx ? await isOrgOnProAutomation(supabase, ctx.orgId) : false;

  return (
    <main className="space-y-6">
      <header>
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          Pro Automation · AI Copywriter
        </p>
        <h1 className="mt-1 font-brand text-2xl font-semibold tracking-tight md:text-[32px] md:leading-[1.15]">
          Generate captions in any language, any platform
        </h1>
        <p className="mt-1 text-sm text-helper">
          Paste a listing&apos;s facts, pick a locale + platform, get caption variants tuned to that combo. Each one reads like a native marketer wrote it — not a translation.
        </p>
      </header>

      {unlocked ? (
        <CopywriterPlayground />
      ) : (
        <LockedSocialModule locale={typedLocale} size="full" />
      )}
    </main>
  );
}
