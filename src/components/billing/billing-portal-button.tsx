'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function BillingPortalButton({ className }: { className?: string }) {
  const t = useTranslations('dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'portal_failed');
        setLoading(false);
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'portal_failed');
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={loading}
        className={
          className ??
          'block w-full rounded-lg px-3 py-2 text-left text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5'
        }
      >
        {loading ? '…' : t('navBilling')}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </>
  );
}
