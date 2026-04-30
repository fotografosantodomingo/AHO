import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { WelcomePoller } from '@/components/billing/welcome-poller';

export const runtime = 'edge';

// Auth-required + reads the user's freshly-created org row, which is
// written by the Stripe webhook between Checkout success and the user
// landing here. Every render must be live.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  return {
    title: t('activeHeading'),
    robots: { index: false, follow: false },
  };
}

/**
 * Post-Checkout return page.
 *
 * Stripe's `success_url` lands the user here with `?session_id=...`. By
 * that time, Stripe has *also* sent `checkout.session.completed` to our
 * webhook, which atomically creates the org + member + subscription rows
 * (see `src/lib/billing/handlers/checkout-session-completed.ts`). The
 * webhook is fast but not instant — the user can sometimes beat it.
 *
 * Render branches:
 *   1. Not signed in       → bounce to /signin?next=<this page>.
 *   2. Missing session_id  → friendly message + link back to /pricing.
 *      (Manual visit / botched redirect / refresh from a stale tab.)
 *   3. No org membership   → "finishing setup" state with a polling
 *      Client Component that calls `router.refresh()` every 2.5s. The
 *      next render will hit branch 4 once the webhook has run.
 *   4. Org membership      → success state with a Dashboard CTA.
 *
 * We deliberately do NOT verify the session_id against Stripe here. The
 * webhook is the source of truth for "this user is now subscribed";
 * trying to confirm payment from this page would race the webhook and
 * also leak the option of clicking around the URL to fake an upgrade.
 * The presence of a populated `organization_members` row IS the proof.
 */
export default async function OnboardingWelcomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const { session_id } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'onboarding' });

  const welcomePath = `/${locale}/${locale === 'es' ? 'inicio/bienvenida' : 'onboarding/welcome'}`;
  const signInPath = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const dashboardPath = `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`;

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    const next = session_id
      ? `${welcomePath}?session_id=${encodeURIComponent(session_id)}`
      : welcomePath;
    redirect(`${signInPath}?next=${encodeURIComponent(next)}`);
  }

  if (!session_id) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('missingSession')}
        </p>
        <a
          href={pricingPath}
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition hover:bg-surface-muted dark:hover:bg-surface-dark"
        >
          {t('backToPricing')}
        </a>
      </main>
    );
  }

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userResult.user.id)
    .limit(1);

  const isActive = !!memberships && memberships.length > 0;

  return (
    <main className="mx-auto max-w-md px-6 py-16 text-center">
      {isActive ? (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('activeHeading')}
          </h1>
          <p className="mt-3 text-sm text-helper">
            {t('activeBody')}
          </p>
          <a
            href={dashboardPath}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-surface-dark px-5 py-2.5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
          >
            {t('openDashboard')}
          </a>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('pendingHeading')}
          </h1>
          <p className="mt-3 text-sm text-helper">
            {t('pendingBody')}
          </p>
          <p className="mt-2 text-xs text-helper">
            {t('pendingNote')}
          </p>
          <p className="mt-6 text-xs text-helper">
            {t('pendingTakingLong')}
          </p>
          <WelcomePoller />
        </>
      )}
    </main>
  );
}
