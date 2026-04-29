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
        <label
          htmlFor="org-name"
          className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
        >
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
          className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100"
        />
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t('orgNameHelp')}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {t('agentPlanName')}
        </legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-white p-3 has-[input:checked]:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:has-[input:checked]:border-zinc-100">
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
            <span className="block text-sm text-zinc-600 dark:text-zinc-400">
              {t('monthlyPrice')}
            </span>
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              {t('trialNote')}
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 bg-white p-3 has-[input:checked]:border-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:has-[input:checked]:border-zinc-100">
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
            <span className="block text-sm text-zinc-600 dark:text-zinc-400">
              {t('annualPrice')}
            </span>
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
              {t('annualSavings')}
            </span>
          </span>
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={loading || orgName.trim().length < 2}
        className="inline-flex w-full items-center justify-center rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
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
