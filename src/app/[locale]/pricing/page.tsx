import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PricingTiers } from '@/components/billing/pricing-tiers';
import { DotGrid } from '@/components/ui/dot-grid';
import {
  getCurrentUserOrgPlan,
  planTierLabel,
} from '@/lib/billing/plan-gating';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing' });
  return {
    title: t('heading'),
    description: t('subheading'),
  };
}

/**
 * /pricing — 3-tier pricing layout (Path 1 from social-distribution
 * spec). Shows Agent ($29) · Plus ($49) · Pro Automation ($99) with
 * shared monthly/annual toggle. Pro Automation is visually highlighted
 * as the upsell tier.
 *
 * Branches:
 *   1. Anonymous → "Sign in to subscribe" CTA per card.
 *   2. Signed-in, no current plan → Subscribe button per card; clicking
 *      prompts for org name then redirects to Stripe Checkout.
 *   3. Signed-in, has a plan → matching tier shows "Current plan" badge
 *      + "Manage billing" CTA pointing at the Customer Portal (which
 *      handles upgrade/downgrade with proration).
 */
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'pricing' });

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const isAuthed = !!userResult.user;

  const planCtx = isAuthed ? await getCurrentUserOrgPlan(supabase) : null;
  const currentTierLabel = planCtx ? planTierLabel(planCtx.planId) : 'none';
  const currentTier =
    currentTierLabel === 'none' ? null : currentTierLabel;

  const signInNext = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const signInPath = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}?next=${encodeURIComponent(signInNext)}`;
  const dashboardPath = `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`;

  const faqItems = [1, 2, 3, 4] as const;

  return (
    <main>
      {/* Hero band. */}
      <section className="relative overflow-hidden border-b border-border">
        <DotGrid />
        <div className="relative mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('eyebrow')}
          </p>
          <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
            {t('heading')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-muted">
            {t('subheading')}
          </p>
        </div>
      </section>

      {/* 3-tier pricing grid — pulled up over the hero seam. */}
      <section className="mx-auto -mt-10 max-w-6xl px-6 pb-16 md:-mt-14">
        <PricingTiers
          isAuthed={isAuthed}
          currentTier={currentTier}
          signInPath={signInPath}
          dashboardPath={dashboardPath}
        />

        {/* FAQ band. */}
        <section className="mt-20 mx-auto max-w-3xl">
          <h2 className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('faqHeading')}
          </h2>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {faqItems.map((n) => (
              <details
                key={n}
                className="group px-1 py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 text-base font-medium">
                  <span>{t(`faq${n}Q` as 'faq1Q')}</span>
                  <span
                    aria-hidden="true"
                    className="text-helper transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted">
                  {t(`faq${n}A` as 'faq1A')}
                </p>
              </details>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
