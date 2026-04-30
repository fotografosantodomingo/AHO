import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PricingForm } from '@/components/billing/pricing-form';
import { BillingPortalButton } from '@/components/billing/billing-portal-button';

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

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="text-center">
        <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[42px] md:leading-[1.19]">
          {t('heading')}
        </h1>
        <p className="mt-3 text-ink-muted dark:text-ink-inverse-muted">{t('subheading')}</p>
      </header>

      <section className="mt-10 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-brand text-xl font-bold">{t('agentPlanName')}</h2>
          <div className="text-right">
            <div className="text-sm">{t('monthlyPrice')}</div>
            <div className="text-xs text-helper">
              {t('annualPrice')} · {t('annualSavings')}
            </div>
          </div>
        </div>

        <ul className="mt-5 space-y-2 text-sm">
          {features.map((key) => (
            <li key={key} className="flex gap-2">
              <span aria-hidden="true" className="text-helper">
                ✓
              </span>
              <span>{t(`features.${key}`)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-8 border-t border-border pt-6">
          {!user ? (
            <a
              href={`${signInPath}?next=${encodeURIComponent(pricingPath)}`}
              className="inline-flex w-full items-center justify-center rounded-lg bg-surface-dark px-5 py-2.5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
            >
              {t('needsSignIn')}
            </a>
          ) : hasMembership ? (
            <div className="space-y-3 text-sm">
              <p>{t('alreadySubscribed')}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <a
                  href={dashboardPath}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-border-strong px-4 py-2 text-sm font-medium transition hover:bg-surface-muted dark:hover:bg-surface-dark"
                >
                  {t('openDashboard')}
                </a>
                <div className="flex-1">
                  <BillingPortalButton className="block w-full rounded-lg bg-surface-dark px-4 py-2 text-center text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink" />
                </div>
              </div>
            </div>
          ) : (
            <PricingForm />
          )}
        </div>
      </section>
    </main>
  );
}
