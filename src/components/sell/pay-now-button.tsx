'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';

/**
 * "Pay $5 →" CTA used on the /sell/private landing page. Click handler
 * POSTs to /api/sell/private/checkout-session (Track D / Agent 3
 * endpoint), receives a Stripe Checkout URL, and redirects the
 * browser. Same shape as `<BillingPortalButton>` — async POST, parse
 * URL, `window.location.href = url`.
 *
 * Track C (this file) only owns the button. The endpoint that creates
 * the Stripe Checkout Session is Agent 3's territory; we POST to its
 * route and trust the contract `{ url: string }`. If the endpoint
 * isn't deployed yet, the button surfaces a network/4xx error inline
 * rather than silently failing.
 */
export function PayNowButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const locale = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sell/private/checkout-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `http_${res.status}`);
        setLoading(false);
        return;
      }
      const body = (await res.json()) as { url?: string };
      if (!body.url) {
        setError('no_url');
        setLoading(false);
        return;
      }
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start">
      <button
        type="button"
        onClick={go}
        disabled={loading}
        className={
          className ??
          'btn-primary inline-flex h-12 items-center px-6 text-base font-semibold disabled:opacity-50'
        }
      >
        {loading ? '…' : label}
      </button>
      {error && (
        <p
          role="alert"
          className="mt-2 text-xs text-red-600 dark:text-red-400"
        >
          {locale === 'es'
            ? 'No se pudo iniciar el pago. Inténtalo de nuevo.'
            : "Couldn't start checkout. Try again."}{' '}
          <span className="opacity-70">({error})</span>
        </p>
      )}
    </div>
  );
}
