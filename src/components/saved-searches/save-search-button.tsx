'use client';

import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { saveSearch } from '@/lib/saved-searches/actions';
import { LOCALES, type Locale } from '@/i18n/config';

interface SaveSearchButtonProps {
  /** Filter state that will be persisted on click. */
  filters: {
    q: string | null;
    city: string | null;
    transaction: string | null;
    minPrice: number | null;
    maxPrice: number | null;
    bedsMin: number | null;
  };
  /**
   * Whether the current visitor is signed in. When false, the button
   * links to /signin?next=/search instead of attempting the save —
   * keeps the UX honest about what's required.
   */
  isAuthenticated: boolean;
}

export function SaveSearchButton({ filters, isAuthenticated }: SaveSearchButtonProps) {
  const t = useTranslations('savedSearches');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<'idle' | 'saved' | 'error'>('idle');

  if (!isAuthenticated) {
    const signinHref = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}?next=${encodeURIComponent(
      `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`,
    )}`;
    return (
      <a
        href={signinHref}
        className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        {t('saveButtonAuth')}
      </a>
    );
  }

  // Reject the no-op case where every filter is null (saving an empty
  // search is useless and would dedupe with any other empty search).
  const hasAnyFilter = Object.values(filters).some((v) => v != null && v !== '');

  return (
    <button
      type="button"
      disabled={pending || state === 'saved' || !hasAnyFilter}
      onClick={() => {
        startTransition(async () => {
          // Strip nulls to match SavedFiltersSchema (which uses optional fields).
          const cleaned: Record<string, unknown> = {};
          if (filters.q) cleaned.q = filters.q;
          if (filters.city) cleaned.city = filters.city;
          if (filters.transaction) cleaned.transaction = filters.transaction;
          if (filters.minPrice != null) cleaned.minPrice = filters.minPrice;
          if (filters.maxPrice != null) cleaned.maxPrice = filters.maxPrice;
          if (filters.bedsMin != null) cleaned.bedsMin = filters.bedsMin;

          const safeLocale: Locale = LOCALES.includes(locale as Locale)
            ? (locale as Locale)
            : 'en';
          const result = await saveSearch({
            filters: cleaned,
            locale: safeLocale,
            notifyEmail: true,
          });
          if (result.ok) {
            setState('saved');
            setTimeout(() => setState('idle'), 4000);
          } else {
            setState('error');
            setTimeout(() => setState('idle'), 4000);
          }
        });
      }}
      className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
    >
      {pending
        ? t('saveButtonSaving')
        : state === 'saved'
          ? t('saveButtonSaved')
          : state === 'error'
            ? t('saveButtonError')
            : t('saveButtonIdle')}
    </button>
  );
}
