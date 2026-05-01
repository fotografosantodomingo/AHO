'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const COOKIE_NAME = 'aho_currency';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const COMMON_CURRENCIES = [
  'USD',
  'EUR',
  'DOP',
  'MXN',
  'BRL',
  'GBP',
  'CAD',
  'COP',
  'ARS',
  'CLP',
] as const;

interface Props {
  /** Initial currency from the server-rendered cookie value (avoids
   *  client-side re-fetch flash). */
  initial: string;
  /** When true, also PATCH /api/me/profile to persist the choice on the
   *  signed-in user's profile.preferred_currency. Anon visitors → cookie
   *  only. */
  persistToProfile: boolean;
}

/**
 * Display-currency picker for the price-tile converter.
 *
 * Worldwide-shaped:
 *   - Cookie-backed for anon (1-year expiry; survives across visits)
 *   - PATCHes profile.preferred_currency for signed-in users so the
 *     choice follows them across devices
 *   - Triggers `router.refresh()` so server-rendered prices recompute
 *     against the new target currency
 *
 * The dropdown shows ISO-4217 codes only (no localized currency names
 * — they bloat the menu and the codes are universally recognized in
 * real estate contexts). Users who don't see their currency get the
 * closest one + the source price stays visible above the conversion.
 */
export function CurrencyPicker({ initial, persistToProfile }: Props) {
  const t = useTranslations('currencyPicker');
  const router = useRouter();
  const [value, setValue] = useState(initial.toUpperCase());
  const [pending, startTransition] = useTransition();

  // Re-sync from the cookie when the page navigates (e.g. signin → the
  // cookie may have been refreshed server-side).
  useEffect(() => {
    setValue(initial.toUpperCase());
  }, [initial]);

  function setCookie(currency: string) {
    document.cookie = `${COOKIE_NAME}=${currency}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
  }

  async function onChange(next: string) {
    setValue(next);
    setCookie(next);

    if (persistToProfile) {
      // Best-effort. If the user is signed-in but the PATCH fails
      // (network blip, RLS edge case), the cookie still applies on
      // this device — they just need to set it again on next device.
      void fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferred_currency: next }),
      }).catch(() => {});
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <label className="inline-flex items-center gap-1 text-xs">
      <span className="sr-only">{t('label')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
        aria-label={t('label')}
        className="h-8 rounded-md border border-border-strong bg-surface px-2 text-xs font-medium tabular-nums shadow-whisper outline-hidden transition focus:ring-3 focus:ring-action disabled:opacity-60 dark:bg-surface-deep dark:focus:ring-action-dark"
      >
        {COMMON_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

export const CURRENCY_COOKIE_NAME = COOKIE_NAME;
