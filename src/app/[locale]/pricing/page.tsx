import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PricingForm } from '@/components/billing/pricing-form';
import { BillingPortalButton } from '@/components/billing/billing-portal-button';
import { DotGrid } from '@/components/ui/dot-grid';

export const runtime = 'edge';

// Auth-dependent: branches on session + existing org membership.
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
 * /pricing — public page with three states:
 *
 *   1. Anonymous       → show plan card + a "Sign in to subscribe" CTA that
 *                        bounces through /signin?next=/pricing.
 *   2. Signed-in,      → show org-name input + plan radio + Subscribe form
 *      no membership     (POSTs to /api/billing/checkout-session).
 *   3. Signed-in,      → show "you're already subscribed" panel with links
 *      has membership    to the dashboard + Customer Portal.
 *
 * Plan price IDs aren't picked here — the client posts {plan: monthly|annual,
 * orgName} to the API route, which selects the env-pinned price ID and
 * creates the Checkout session. Founder-rate gating happens at webhook time
 * (see `DECISIONS.md` "Founder-rate pricing is application-gated").
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
  const user = userResult.user ?? null;

  let hasMembership = false;
  if (user) {
    const { data: memberships } = await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1);
    hasMembership = !!memberships && memberships.length > 0;
  }

  const signInPath = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const dashboardPath = `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`;

  const features = [
    'listings',
    'social',
    'whatsapp',
    'inbox',
    'analytics',
    'billing',
  ] as const;

  const faqItems = [1, 2, 3, 4] as const;

  return (
    <main>
      {/* Hero band — same dot-grid treatment as homepage. Centers the
          page identity before the plan card. */}
      <section className="relative overflow-hidden border-b border-border">
        <DotGrid />
        <div className="relative mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('eyebrow')}
          </p>
          <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
            {t('heading')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-muted dark:text-ink-inverse-muted">
            {t('subheading')}
          </p>
        </div>
      </section>

      {/* Plan card. Pulled up over the hero/body seam with -mt-12 so the
          "Save ~17% with annual" pill sits on the seam line — a small
          HashiCorp-y depth move. */}
      <section className="mx-auto -mt-12 max-w-3xl px-6 pb-16 md:-mt-16">
        <div className="relative rounded-card border border-border-strong/40 bg-surface p-6 shadow-whisper md:p-8 dark:bg-surface-deep">
          <span className="absolute -top-3 left-6 inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-action shadow-whisper dark:bg-surface-deep dark:text-action-dark">
            {t('annualPill')}
          </span>

          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-border pb-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-helper">
                {t('agentPlanName')}
              </p>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="font-brand text-5xl font-semibold tracking-tight tabular-nums">
                  {t('priceHeading')}
                </span>
                <span className="text-base text-helper">{t('priceSubheading')}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-brand text-base font-medium tabular-nums">
                {t('annualPrice')}
              </div>
              <div className="text-xs text-helper">{t('annualSavings')}</div>
              <div className="mt-2 inline-flex items-center rounded-md bg-warn-bg/70 px-2 py-0.5 text-xs font-medium text-warn">
                {t('trialBadge')}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {t('featuresHeading')}
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {features.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-action/15 text-[10px] font-semibold text-action dark:bg-action-dark/20 dark:text-action-dark"
                  >
                    ✓
                  </span>
                  <span className="text-ink-muted dark:text-ink-inverse-muted">
                    {t(`features.${key}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-8 border-t border-border pt-6">
            {!user ? (
              <a
                href={`${signInPath}?next=${encodeURIComponent(pricingPath)}`}
                className="btn-primary w-full"
              >
                {t('needsSignIn')}
              </a>
            ) : hasMembership ? (
              <div className="space-y-3 text-sm">
                <p>{t('alreadySubscribed')}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <a
                    href={dashboardPath}
                    className="inline-flex flex-1 items-center justify-center rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    {t('openDashboard')}
                  </a>
                  <div className="flex-1">
                    <BillingPortalButton className="btn-primary w-full" />
                  </div>
                </div>
              </div>
            ) : (
              <PricingForm />
            )}
          </div>
        </div>

        {/* FAQ band. Pure HTML <details> for progressive enhancement —
            keyboard accessible, JS-free, indexable as content. */}
        <section className="mt-16">
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
                <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
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
