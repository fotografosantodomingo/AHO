import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { resolveUpgradeEligibility } from '@/lib/billing/upgrade-to-annual';
import { formatPrice } from '@/lib/listings/format';
import { UpgradeConfirmCard } from '@/components/billing/upgrade-confirm-card';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /{locale}/dashboard/billing
 *
 * Single-purpose surface today: handles the `?upgrade=annual` route from
 * the payment-receipt email's CTA. Server-renders a confirmation card
 * with the actual saving math (no client-trustable numbers) + a Confirm
 * button that POSTs to /api/billing/upgrade-to-annual.
 *
 * Welcome bonus: when the user lands within 3 days of sub creation AND
 * the query string has ?welcome=1, the card surfaces the WELCOME5 line.
 * Server verifies the window via resolveUpgradeEligibility() — the
 * query string is only a hint, never the source of truth for the
 * discount.
 *
 * If the user has no eligible monthly subscription (already on annual,
 * no sub at all, etc.), we punt to the Stripe Customer Portal which
 * handles the broader subscription-management surface.
 */
export default async function BillingPage({
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

  const sp = await searchParams;
  const wantsAnnualUpgrade = sp.upgrade === 'annual';

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    redirect(
      `${localePath(typedLocale, '/signin')}?next=${encodeURIComponent(
        localePath(typedLocale, '/dashboard/billing'),
      )}`,
    );
  }

  // Only route we handle on this page today is the upgrade flow.
  // Anything else → bounce to the Stripe Customer Portal (the existing
  // self-serve billing surface).
  if (!wantsAnnualUpgrade) {
    redirect(localePath(typedLocale, '/dashboard'));
  }

  const eligibility = await resolveUpgradeEligibility(userResult.user.id);
  if (!eligibility) {
    // Either no sub, sub is already annual, or the tier doesn't have an
    // annual price configured. Send them to the Portal — it explains
    // their subscription state and lets them act.
    redirect(localePath(typedLocale, '/dashboard'));
  }

  const monthlyAnnualized = eligibility.monthlyCents * 12;
  const savingsCents = Math.max(0, monthlyAnnualized - eligibility.annualCents);
  const welcomeBonusCents = eligibility.inWelcomeWindow
    ? Math.round(eligibility.annualCents * 0.05)
    : 0;

  // The card itself is a client component (form submit + loading state).
  // All numbers above are server-resolved.
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <UpgradeConfirmCard
        tier={eligibility.tier}
        currency={eligibility.currency}
        monthlyLabel={formatPrice(eligibility.monthlyCents, eligibility.currency, typedLocale)}
        annualLabel={formatPrice(eligibility.annualCents, eligibility.currency, typedLocale)}
        annualizedMonthlyLabel={formatPrice(
          monthlyAnnualized,
          eligibility.currency,
          typedLocale,
        )}
        savingsLabel={formatPrice(savingsCents, eligibility.currency, typedLocale)}
        welcomeBonusLabel={
          welcomeBonusCents > 0
            ? formatPrice(welcomeBonusCents, eligibility.currency, typedLocale)
            : null
        }
        inWelcomeWindow={eligibility.inWelcomeWindow}
        locale={typedLocale}
      />
    </main>
  );
}
