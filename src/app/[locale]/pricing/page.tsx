import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PricingTiers } from '@/components/billing/pricing-tiers';
import { DotGrid } from '@/components/ui/dot-grid';
import {
  getCurrentUserOrgPlan,
  planTierLabel,
} from '@/lib/billing/plan-gating';
import { publicEnv } from '@/lib/env';
import { buildProduct, serializeJsonLd } from '@/lib/seo/jsonld';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Stable price catalog for the JSON-LD `Product` nodes. Mirrors the
 * `PRICING` map in `components/billing/pricing-tiers.tsx`. Both must
 * stay in sync — when prices change, update both. Co-locating here
 * (instead of importing the client-component constant) avoids a
 * server-importing-client lint warning.
 */
const PRICING_USD: Record<'agent' | 'plus' | 'pro_automation', { monthly: number; annual: number }> = {
  agent: { monthly: 29, annual: 290 },
  plus: { monthly: 49, annual: 490 },
  pro_automation: { monthly: 99, annual: 990 },
};

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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  // ?focus=<tier> renders only that tier card with its full feature
  // list — used by Pro Automation CTAs in the homepage hero, the social
  // dashboard's locked module, and any future tier-specific link.
  // Unknown / missing values fall back to the full 3-tier comparison.
  const sp = await searchParams;
  const focusRaw = Array.isArray(sp.focus) ? sp.focus[0] : sp.focus;
  const focusTier =
    focusRaw === 'agent' || focusRaw === 'plus' || focusRaw === 'pro_automation'
      ? focusRaw
      : null;

  const typedLocale = locale as Locale;
  const signInNext = `${localePath(typedLocale, '/pricing')}${
    focusTier ? `?focus=${focusTier}` : ''
  }`;
  const signInPath = `${localePath(typedLocale, '/signin')}?next=${encodeURIComponent(signInNext)}`;
  const dashboardPath = localePath(typedLocale, '/dashboard');
  const fullPricingHref = localePath(typedLocale, '/pricing');

  const faqItems = [1, 2, 3, 4] as const;

  // JSON-LD: one Product node per tier, each with two Offers (monthly +
  // annual) priced in USD. SaaS plans ARE products in schema.org's
  // vocabulary — Stripe, HubSpot, Atlassian all use the same shape.
  // We deliberately do NOT emit `aggregateRating` because we don't
  // have plan-level user ratings; faking a default would violate
  // CLAUDE.md hard rule #8. When `?focus=<tier>` is active we still
  // emit all three Products — focus is a UX layer, not a SEO one;
  // crawlers should always see the full catalog.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const pricingUrl = `${site}${fullPricingHref}`;
  const tierKeys: Array<'agent' | 'plus' | 'pro_automation'> = ['agent', 'plus', 'pro_automation'];
  const productLds = tierKeys.map((tier) =>
    buildProduct({
      name: `AHO ${t(`tier.${tier}.name` as 'tier.agent.name')}`,
      description: t(`tier.${tier}.tagline` as 'tier.agent.tagline'),
      url: `${pricingUrl}#${tier}`,
      brand: 'AHO',
      offers: [
        {
          price: PRICING_USD[tier].monthly,
          priceCurrency: 'USD',
          url: pricingUrl,
          description: t('period.monthly'),
        },
        {
          price: PRICING_USD[tier].annual,
          priceCurrency: 'USD',
          url: pricingUrl,
          description: t('period.annual'),
        },
      ],
    }),
  );

  return (
    <main>
      {productLds.map((ld, idx) => (
        <script
          key={`pld-${tierKeys[idx]}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(ld) }}
        />
      ))}
      {/* Hero band. */}
      <section className="relative overflow-hidden border-b border-border">
        <DotGrid />
        <div className="relative mx-auto max-w-3xl px-6 py-16 text-center md:py-20">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {focusTier ? t(`focus.${focusTier}.eyebrow` as 'focus.pro_automation.eyebrow') : t('eyebrow')}
          </p>
          <h1 className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.12]">
            {focusTier ? t(`focus.${focusTier}.heading` as 'focus.pro_automation.heading') : t('heading')}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-ink-muted">
            {focusTier ? t(`focus.${focusTier}.subheading` as 'focus.pro_automation.subheading') : t('subheading')}
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
          focusTier={focusTier}
        />
        {focusTier && (
          <div className="mt-8 text-center">
            <a
              href={fullPricingHref}
              className="text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
            >
              {t('compareAllPlans')}
            </a>
          </div>
        )}

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
