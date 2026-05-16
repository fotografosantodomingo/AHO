'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

interface Props {
  tier: 'agent' | 'plus' | 'pro_automation';
  currency: string;
  monthlyLabel: string;
  annualLabel: string;
  annualizedMonthlyLabel: string;
  savingsLabel: string;
  welcomeBonusLabel: string | null;
  inWelcomeWindow: boolean;
  locale: Locale;
}

const TIER_NAME: Record<Props['tier'], string> = {
  agent: 'Agent',
  plus: 'Agent Plus',
  pro_automation: 'Pro Automation',
};

/**
 * Confirmation card on /dashboard/billing?upgrade=annual.
 *
 * Server-rendered numbers (saving math, welcome bonus availability) are
 * passed in as props — never recomputed client-side. The card just owns
 * the submit-button state machine + redirect after the API call.
 */
export function UpgradeConfirmCard({
  tier,
  monthlyLabel,
  annualLabel,
  annualizedMonthlyLabel,
  savingsLabel,
  welcomeBonusLabel,
  inWelcomeWindow,
  locale,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/upgrade-to-annual', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ applyWelcome: inWelcomeWindow }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        redirectUrl?: string;
        errorCode?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.errorCode ?? `http_${res.status}`);
        return;
      }
      if (json.redirectUrl) {
        window.location.assign(json.redirectUrl);
      } else {
        router.push(localePath(locale, '/dashboard'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-surface p-7 shadow-whisper dark:bg-surface-deep">
      <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
        Switch to annual
      </p>
      <h1 className="mt-2 font-brand text-2xl font-semibold tracking-tight md:text-[28px]">
        Upgrade your {TIER_NAME[tier]} plan
      </h1>
      <p className="mt-2 text-sm text-ink-muted dark:text-ink-inverse-muted">
        You pay for 10 months instead of 12. Same plan, same features, billed
        once a year. You can switch back from your billing portal anytime.
      </p>

      <dl className="mt-6 space-y-3 rounded-card border border-border/60 bg-surface-muted/50 p-4 text-sm dark:bg-surface-dark/40">
        <div className="flex items-center justify-between">
          <dt className="text-helper">Current plan</dt>
          <dd className="font-medium">{monthlyLabel}/month</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-helper">12× monthly equivalent</dt>
          <dd className="font-mono text-helper line-through">{annualizedMonthlyLabel}</dd>
        </div>
        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <dt className="font-medium">Annual price</dt>
          <dd className="font-mono text-base font-semibold text-action dark:text-action-dark">
            {annualLabel}/year
          </dd>
        </div>
        <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
          <dt className="font-medium">You save</dt>
          <dd className="font-mono font-semibold">{savingsLabel}</dd>
        </div>
        {welcomeBonusLabel && (
          <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">
            <dt className="font-medium">🎁 Welcome bonus (3-day window)</dt>
            <dd className="font-mono font-semibold">−{welcomeBonusLabel}</dd>
          </div>
        )}
      </dl>

      {welcomeBonusLabel && (
        <p className="mt-3 text-xs text-helper">
          You're still inside the 3-day window from your first payment. The
          WELCOME5 coupon (5% off) is applied automatically when you confirm.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          Upgrade failed: {error}. Try again or contact info@advertisehomes.online.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting}
          className="btn-primary inline-flex h-11 items-center px-6 disabled:opacity-50"
        >
          {submitting ? 'Upgrading…' : 'Confirm upgrade'}
        </button>
        <a
          href={localePath(locale, '/dashboard')}
          className="inline-flex h-11 items-center rounded-lg border border-border-strong px-5 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
        >
          Cancel
        </a>
      </div>

      <p className="mt-6 text-xs text-helper">
        Charged now: prorated difference between your remaining monthly and
        the annual plan{welcomeBonusLabel ? ', minus the 5% welcome bonus' : ''}.
        Future renewals are once a year.
      </p>
    </div>
  );
}
