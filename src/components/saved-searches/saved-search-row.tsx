'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  deleteSavedSearch,
  toggleSavedSearchNotify,
} from '@/lib/saved-searches/actions';
import type { Locale } from '@/i18n/config';

interface SavedSearchRowProps {
  id: string;
  name: string | null;
  filters: Record<string, unknown>;
  notifyEmail: boolean;
  createdAt: string;
  locale: Locale;
}

/**
 * One row in the saved-searches list. Renders the saved filter set as
 * human-readable chips, plus toggle/delete controls.
 *
 * Filter formatting is locale-aware — price/transaction labels come
 * from the existing `property` namespace, the rest from `savedSearches`.
 */
export function SavedSearchRow({
  id,
  name,
  filters,
  notifyEmail,
  createdAt,
  locale,
}: SavedSearchRowProps) {
  const t = useTranslations('savedSearches');
  const tProperty = useTranslations('property');
  const [pending, startTransition] = useTransition();
  const [removed, setRemoved] = useState(false);
  const [notifyState, setNotifyState] = useState(notifyEmail);

  if (removed) return null;

  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Build the search-page URL preserving the saved filters. Same shape
  // as buildSearchUrl but inline so this component stays client-side
  // (server modules can't be imported here).
  const searchPath = locale === 'es' ? 'buscar' : 'search';
  const params = new URLSearchParams();
  if (typeof filters.q === 'string') params.set('q', filters.q);
  if (typeof filters.city === 'string') params.set('city', filters.city);
  if (typeof filters.transaction === 'string')
    params.set('transaction', filters.transaction);
  if (typeof filters.minPrice === 'number')
    params.set('min_price', String(filters.minPrice));
  if (typeof filters.maxPrice === 'number')
    params.set('max_price', String(filters.maxPrice));
  if (typeof filters.bedsMin === 'number')
    params.set('beds_min', String(filters.bedsMin));
  const qs = params.toString();
  const viewUrl = `/${locale}/${searchPath}${qs ? `?${qs}` : ''}`;

  const filterChips: string[] = [];
  if (typeof filters.q === 'string')
    filterChips.push(t('filterKeyword', { q: filters.q }));
  if (typeof filters.city === 'string')
    filterChips.push(t('filterCity', { city: filters.city }));
  if (typeof filters.transaction === 'string')
    filterChips.push(
      t('filterTransaction', {
        type: tProperty(`transactionType.${filters.transaction as 'sale'}`),
      }),
    );
  if (typeof filters.minPrice === 'number' && typeof filters.maxPrice === 'number') {
    filterChips.push(
      t('filterPriceRange', {
        min: filters.minPrice,
        max: filters.maxPrice,
      }),
    );
  } else if (typeof filters.minPrice === 'number') {
    filterChips.push(t('filterMinPrice', { min: filters.minPrice }));
  } else if (typeof filters.maxPrice === 'number') {
    filterChips.push(t('filterMaxPrice', { max: filters.maxPrice }));
  }
  if (typeof filters.bedsMin === 'number')
    filterChips.push(t('filterBedsMin', { beds: filters.bedsMin }));

  return (
    <li className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('savedOn', { date: dateFormatter.format(new Date(createdAt)) })}
          </p>
          {name && <p className="font-brand text-base font-bold">{name}</p>}
          {filterChips.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {filterChips.map((chip, idx) => (
                <li
                  key={idx}
                  className="rounded-lg border border-border-strong/60 bg-surface-muted px-2 py-0.5 text-xs dark:bg-surface-dark"
                >
                  {chip}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-helper">
            {notifyState ? t('alertsOn') : t('alertsOff')}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <a
            href={viewUrl}
            className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-xs transition hover:bg-surface-muted dark:hover:bg-surface-dark"
          >
            {t('viewResults')}
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const next = !notifyState;
                setNotifyState(next);
                const r = await toggleSavedSearchNotify(id, next);
                if (!r.ok) setNotifyState(!next); // revert on failure
              });
            }}
            className="inline-flex h-8 items-center rounded-lg border border-border-strong/60 px-3 text-xs transition hover:bg-surface-muted disabled:opacity-50 dark:hover:bg-surface-dark"
          >
            {notifyState ? t('alertsToggleOff') : t('alertsToggleOn')}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm('Delete this saved search?')) return;
              startTransition(async () => {
                const r = await deleteSavedSearch(id);
                if (r.ok) setRemoved(true);
              });
            }}
            className="inline-flex h-8 items-center rounded-lg border border-warn/40 bg-warn-bg/40 px-3 text-xs text-warn transition hover:bg-warn-bg disabled:opacity-50"
          >
            {t('deleteCta')}
          </button>
        </div>
      </div>
    </li>
  );
}
