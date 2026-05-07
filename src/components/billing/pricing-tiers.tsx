'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';

type Tier = 'agent' | 'plus' | 'pro_automation';
type Period = 'monthly' | 'annual';

interface PriceCfg {
  monthly: number;
  annual: number;
}

const PRICING: Record<Tier, PriceCfg> = {
  agent: { monthly: 29, annual: 290 },
  plus: { monthly: 49, annual: 490 },
  pro_automation: { monthly: 99, annual: 990 },
};

interface Props {
  /** True if the visitor is signed in. Affects CTAs (subscribe vs sign-in). */
  isAuthed: boolean;
  /** True if the signed-in user has an existing org with a current_plan_id.
   *  When set, replace each tier's Subscribe CTA with "Manage billing" /
   *  "Current plan" badges. The Customer Portal handles the upgrade flow. */
  currentTier: Tier | null;
  /** Path to /signin?next=/pricing for anon users. */
  signInPath: string;
  /** Path to /dashboard for signed-in users with existing subscriptions. */
  dashboardPath: string;
  /**
   * When set, render only the named tier's card (used by Pro Automation
   * deep-links from the homepage hero + social dashboard locked module).
   * Null = default 3-tier comparison. The wrapping page also surfaces a
   * "compare all plans" link out when a focus is active.
   */
  focusTier?: Tier | null;
}

/**
 * Three-tier pricing card layout for `/pricing`. Shared monthly/annual
 * toggle at the top; each card displays its tier's price for the
 * selected period + tier-specific feature list + Subscribe CTA.
 *
 * Pro Automation (the highest tier with social automation unlock) is
 * visually highlighted — slightly bigger card, "Most popular" badge,
 * forest-green border.
 *
 * For signed-in users with an existing plan, the matching tier shows a
 * "Current plan" pill and the CTA flips to "Manage billing" pointing
 * at the Customer Portal. The Stripe Customer Portal handles the
 * upgrade-from-Agent-to-Pro flow with proration.
 */
export function PricingTiers({
  isAuthed,
  currentTier,
  signInPath,
  dashboardPath,
  focusTier = null,
}: Props) {
  const t = useTranslations('pricing');
  const locale = useLocale() as Locale;
  const [period, setPeriod] = useState<Period>('monthly');
  const [pendingTier, setPendingTier] = useState<Tier | null>(null);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function subscribe(tier: Tier) {
    if (pendingTier) return;
    if (!isAuthed) {
      window.location.assign(signInPath);
      return;
    }
    setPendingTier(tier);
    setError(null);
    startTransition(async () => {
      try {
        // Org name needed for new subscriptions. For existing-org
        // upgrades, the portal handles it; this branch is for fresh.
        const orgName = window.prompt(t('orgNamePrompt'), '');
        if (!orgName || orgName.trim().length < 2) {
          setPendingTier(null);
          return;
        }
        const res = await fetch('/api/billing/checkout-session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            tier,
            plan: period,
            orgName: orgName.trim(),
            locale,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.assign(data.url);
        } else {
          throw new Error('no url in response');
        }
      } catch {
        setError(t('subscribeError'));
        setPendingTier(null);
      }
    });
  }

  const allTiers: Array<{ id: Tier; emphasized: boolean }> = [
    { id: 'agent', emphasized: false },
    { id: 'plus', emphasized: false },
    { id: 'pro_automation', emphasized: true },
  ];
  // Focus mode renders ONLY the named tier (centered, single column).
  // Visited from /pricing?focus=pro_automation deep-links — the user
  // already knows which plan they're considering, so the comparison is
  // distracting noise.
  const tiers = focusTier
    ? allTiers.filter((tt) => tt.id === focusTier)
    : allTiers;

  return (
    <div>
      {/* Period toggle — shared across all 3 cards. Mobile-tightened
          after PO report 2026-05-07: tabs now `whitespace-nowrap` so the
          "save ~17%" badge can't wrap onto a second line and shift the
          tap target mid-render; `touch-action-manipulation` kills the
          iOS 300ms double-tap-zoom delay; `select-none` prevents iOS
          long-press text-selection from intercepting the tap; min-h-11
          meets the 44px iOS tap-target guideline; the badge has
          `pointer-events-none` so a tap on it routes cleanly to the
          parent button without any inner-element ambiguity. */}
      <div className="mb-8 flex justify-center px-2">
        <div
          role="tablist"
          aria-label={t('periodToggleAria')}
          className="inline-flex max-w-full rounded-full border border-border-strong bg-surface p-1 shadow-whisper dark:bg-surface-deep"
        >
          {(['monthly', 'annual'] as const).map((p) => {
            const active = period === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriod(p)}
                style={{ touchAction: 'manipulation' }}
                className={
                  active
                    ? 'inline-flex min-h-11 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-full bg-action px-4 py-1.5 text-sm font-semibold text-white shadow-whisper transition sm:px-5'
                    : 'inline-flex min-h-11 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium text-ink transition hover:bg-black/5 dark:text-ink-inverse dark:hover:bg-white/5 sm:px-5'
                }
              >
                {t(`period.${p}`)}
                {p === 'annual' && (
                  <span
                    aria-hidden="true"
                    className={
                      active
                        ? 'pointer-events-none ml-1.5 text-[11px] opacity-90'
                        : 'pointer-events-none ml-1.5 text-[11px] text-action dark:text-action-dark'
                    }
                  >
                    {t('annualBadge')}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={
          tiers.length === 1
            ? 'mx-auto max-w-lg'
            : 'grid grid-cols-1 gap-6 lg:grid-cols-3'
        }
      >
        {tiers.map(({ id: tier, emphasized }) => {
          const isCurrent = currentTier === tier;
          const price = PRICING[tier][period];

          return (
            <div
              key={tier}
              className={
                emphasized
                  ? 'relative flex flex-col rounded-card border-2 border-action bg-surface p-6 shadow-lift md:p-8'
                  : 'flex flex-col rounded-card border border-border-strong/40 bg-surface p-6 shadow-whisper md:p-8'
              }
            >
              {emphasized && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center rounded-full bg-action px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white shadow-whisper">
                  {t('mostPopular')}
                </span>
              )}
              {isCurrent && (
                <span className="absolute -top-3 right-6 inline-flex items-center rounded-full bg-accent-tint px-3 py-1 text-xs font-semibold uppercase tracking-wider text-accent">
                  {t('currentPlan')}
                </span>
              )}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                  {t(`tier.${tier}.eyebrow` as 'tier.agent.eyebrow')}
                </p>
                <h3 className="mt-1 font-brand text-2xl font-semibold tracking-tight">
                  {t(`tier.${tier}.name` as 'tier.agent.name')}
                </h3>
                <p className="mt-2 text-sm text-ink-muted">
                  {t(`tier.${tier}.tagline` as 'tier.agent.tagline')}
                </p>
              </div>

              <div className="mt-5 flex items-baseline gap-1">
                <span className="font-brand text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">
                  ${price}
                </span>
                <span className="text-sm text-helper">
                  {period === 'monthly' ? t('perMonth') : t('perYear')}
                </span>
              </div>

              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {(
                  ['feat1', 'feat2', 'feat3', 'feat4', 'feat5'] as const
                ).map((key) => {
                  const text = t(
                    `tier.${tier}.${key}` as 'tier.agent.feat1',
                    { defaultValue: '' },
                  );
                  if (!text) return null;
                  return (
                    <li key={key} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-action/15 text-[10px] font-semibold text-action"
                      >
                        ✓
                      </span>
                      <span className="text-ink-muted">{text}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-6">
                {isCurrent ? (
                  <Link
                    href={dashboardPath}
                    className="btn-secondary w-full"
                  >
                    {t('manageBilling')}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => subscribe(tier)}
                    disabled={pendingTier === tier}
                    className={
                      emphasized
                        ? 'btn-primary w-full disabled:opacity-60'
                        : 'btn-secondary w-full disabled:opacity-60'
                    }
                  >
                    {pendingTier === tier
                      ? t('redirecting')
                      : isAuthed
                      ? t('subscribe')
                      : t('signInToSubscribe')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mt-4 text-center text-sm text-error">
          {error}
        </p>
      )}
    </div>
  );
}
