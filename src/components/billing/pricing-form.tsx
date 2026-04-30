'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

/**
 * Pricing page form — collects the org display name + chosen billing
 * cadence and POSTs to `/api/billing/checkout-session`. On success we
 * navigate the browser to Stripe's hosted Checkout URL.
 *
 * Plan selection is a radio (monthly default). Submit button label tracks
 * the selected plan so the action stays unambiguous.
 */
export function PricingForm() {
  const t = useTranslations('pricing');
  const locale = useLocale();
  const [orgName, setOrgName] = useState('');
  const [plan, setPlan] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/billing/checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan, orgName: orgName.trim(), locale }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'session_create_failed');
        setLoading(false);
        return;
      }
      const { url } = await res.json();
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'session_create_failed');
      setLoading(false);
    }
  }

  const submitLabel =
    plan === 'monthly' ? t('subscribeMonthly') : t('subscribeAnnual');

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div>
        <label htmlFor="org-name" className="block text-sm font-medium">
          {t('orgNameLabel')}
        </label>
        <input
          id="org-name"
          name="orgName"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
        />
        <p className="mt-1 text-xs text-helper">{t('orgNameHelp')}</p>
      </div>

      <fieldset className="space-y-2">
        <legend className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('agentPlanName')}
        </legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-whisper has-[input:checked]:border-ink dark:bg-surface-deep dark:has-[input:checked]:border-ink-inverse">
          <input
            type="radio"
            name="plan"
            value="monthly"
            checked={plan === 'monthly'}
            onChange={() => setPlan('monthly')}
            className="mt-1"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium">{t('monthly')}</span>
            <span className="block text-sm text-ink-muted dark:text-ink-inverse-muted">
              {t('monthlyPrice')}
            </span>
            <span className="mt-1 block text-xs text-helper">{t('trialNote')}</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-3 shadow-whisper has-[input:checked]:border-ink dark:bg-surface-deep dark:has-[input:checked]:border-ink-inverse">
          <input
            type="radio"
            name="plan"
            value="annual"
            checked={plan === 'annual'}
            onChange={() => setPlan('annual')}
            className="mt-1"
          />
          <span className="flex-1">
            <span className="block text-sm font-medium">{t('annual')}</span>
            <span className="block text-sm text-ink-muted dark:text-ink-inverse-muted">
              {t('annualPrice')}
            </span>
            <span className="mt-1 block text-xs text-helper">{t('annualSavings')}</span>
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={loading || orgName.trim().length < 2}
        className="inline-flex w-full items-center justify-center rounded-lg bg-surface-dark px-5 py-2.5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink disabled:opacity-50"
      >
        {loading ? t('redirecting') : submitLabel}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {t('errors.session_create_failed')}
        </p>
      )}
    </form>
  );
}
