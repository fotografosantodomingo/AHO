import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { WelcomePoller } from '@/components/billing/welcome-poller';
import {
  OnboardingWizard,
  type OnboardingWizardInitial,
} from '@/components/onboarding/onboarding-wizard';
import {
  getCurrentUserOrgPlan,
  planTierLabel,
} from '@/lib/billing/plan-gating';

export const runtime = 'edge';

// Auth-required + reads the user's profile + (when present) the freshly-
// created org row written by the Stripe webhook between Checkout success
// and the user landing here. Every render must be live.
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
 * Two-purpose page:
 *
 *   A. Post-Checkout return surface (URL has `?session_id=...`).
 *      Stripe's `success_url` lands the user here after the webhook
 *      atomically creates the org + member + subscription rows
 *      (see `src/lib/billing/handlers/checkout-session-completed.ts`).
 *      The webhook is fast but not instant — the user can sometimes
 *      beat it; we poll until membership exists.
 *
 *   B. First-run onboarding wizard for newly-signed-up agents
 *      (URL has NO `session_id`). Multi-step soft funnel: welcome,
 *      profile basics, social/WhatsApp connect, first-listing CTA.
 *      Soft funnel — every step has Skip and the wizard never gates
 *      dashboard access. PUTs incrementally to /api/me/profile so
 *      progress survives a tab close.
 *
 * We deliberately do NOT verify the session_id against Stripe in flow
 * A. The webhook is the source of truth for "this user is now
 * subscribed"; trying to confirm payment from this page would race the
 * webhook and also leak the option of clicking around the URL to fake
 * an upgrade. The presence of a populated `organization_members` row
 * IS the proof.
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

  const typedLocale = locale as Locale;
  const welcomePath = localePath(typedLocale, '/onboarding/welcome');
  const signInPath = localePath(typedLocale, '/signin');
  const pricingPath = localePath(typedLocale, '/pricing');
  const dashboardPath = localePath(typedLocale, '/dashboard');

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    const next = session_id
      ? `${welcomePath}?session_id=${encodeURIComponent(session_id)}`
      : welcomePath;
    redirect(`${signInPath}?next=${encodeURIComponent(next)}`);
  }

  // ─── Flow A: post-Stripe-Checkout success ────────────────────────
  if (session_id) {
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
            <p className="mt-3 text-sm text-helper">{t('activeBody')}</p>
            <a href={dashboardPath} className="btn-primary mt-6">
              {t('openDashboard')}
            </a>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t('pendingHeading')}
            </h1>
            <p className="mt-3 text-sm text-helper">{t('pendingBody')}</p>
            <p className="mt-2 text-xs text-helper">{t('pendingNote')}</p>
            <p className="mt-6 text-xs text-helper">
              {t('pendingTakingLong')}
            </p>
            <WelcomePoller />
          </>
        )}
      </main>
    );
  }

  // ─── Flow B: first-run onboarding wizard ─────────────────────────
  // Voluntary visit. We had a "missing session" branch here previously —
  // that was for users who manually navigated or refreshed a stale
  // Checkout success URL. Now this page is the agent's first-run
  // landing surface, so a no-session_id arrival is the *normal* case.
  // Users with a recent paid Checkout still hit Flow A via session_id;
  // anyone landing here without one gets the wizard.

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'full_name, city, country_code, bio, languages_spoken, whatsapp_phone, facebook_url, instagram_url, linkedin_url',
    )
    .eq('id', userResult.user.id)
    .maybeSingle();

  const orgPlan = await getCurrentUserOrgPlan(supabase);
  const planTier = planTierLabel(orgPlan?.planId ?? null);

  // "Does any country have agents?" — drives the only on-page trust
  // signal that needs a real number. Cheap query, filters out test
  // fixtures per the public-surface convention.
  let hasLiveAgents = false;
  try {
    const { count } = await supabase
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'agent')
      .not('public_slug', 'is', null);
    hasLiveAgents = (count ?? 0) > 0;
  } catch {
    hasLiveAgents = false;
  }

  const initial: OnboardingWizardInitial = {
    fullName: profile?.full_name ?? null,
    city: profile?.city ?? null,
    countryCode: profile?.country_code ?? null,
    bio: profile?.bio ?? null,
    languagesSpoken: (profile?.languages_spoken as string[] | null) ?? [],
    whatsappPhone: profile?.whatsapp_phone ?? null,
    facebookUrl: profile?.facebook_url ?? null,
    instagramUrl: profile?.instagram_url ?? null,
    linkedinUrl: profile?.linkedin_url ?? null,
  };

  return (
    <main className="mx-auto px-4 py-12 sm:py-16">
      <OnboardingWizard
        initial={initial}
        planTier={planTier}
        hasLiveAgents={hasLiveAgents}
      />
      <p className="mt-6 text-center text-xs text-helper">
        <a
          href={pricingPath}
          className="underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
        >
          {t('backToPricing')}
        </a>
      </p>
    </main>
  );
}
