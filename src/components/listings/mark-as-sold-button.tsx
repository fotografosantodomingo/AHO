'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  currency: string;
  /** What status this transitions to. 'sold' for sales, 'rented' for rentals. */
  intent: 'sold' | 'rented';
}

/**
 * Modal-driven "Mark as sold" button. Date is required (defaults to
 * today); price is optional (confidential closings). Side and notes
 * fully optional.
 *
 * On success: refreshes the page so the edit-page status badge + the
 * dashboard listing table + the agent profile stat tiles all show the
 * new state.
 */
export function MarkAsSoldButton({ id, currency, intent }: Props) {
  const t = useTranslations('markSold');
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10); // yyyy-mm-dd
  const [soldDate, setSoldDate] = useState(today);
  const [soldPrice, setSoldPrice] = useState(''); // whole units, optional
  const [side, setSide] = useState<'' | 'buyer' | 'seller' | 'both'>('');
  const [notes, setNotes] = useState('');

  async function submit() {
    setError(null);
    setPending(true);
    try {
      const body: Record<string, unknown> = {
        sold_date: new Date(`${soldDate}T12:00:00Z`).toISOString(),
        status: intent,
      };
      if (soldPrice.trim().length > 0) {
        const cents = Math.round(Number(soldPrice) * 100);
        if (!Number.isFinite(cents) || cents <= 0) {
          setError('invalid_price');
          setPending(false);
          return;
        }
        body.sold_price_cents = cents;
      }
      if (side) body.represented_side = side;
      if (notes.trim().length > 0) body.closing_notes = notes.trim();

      const res = await fetch(`/api/listings/${id}/sold`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.errorCode ?? `http_${res.status}`);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-lg border border-blue-600 bg-blue-50 px-3 text-sm font-medium text-blue-900 transition hover:bg-blue-100 dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-100 dark:hover:bg-blue-950/60"
      >
        {intent === 'rented' ? t('buttonRent') : t('buttonSale')}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mark-sold-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-card border border-border-strong/40 bg-surface p-6 shadow-lg dark:bg-surface-deep">
            <h2 id="mark-sold-title" className="font-brand text-lg font-semibold tracking-tight">
              {intent === 'rented' ? t('headingRent') : t('headingSale')}
            </h2>
            <p className="mt-1 text-sm text-helper">{t('subheading')}</p>

            <div className="mt-5 space-y-4">
              <div>
                <label htmlFor="ms-date" className="block text-sm font-medium">
                  {t('date')} *
                </label>
                <input
                  id="ms-date"
                  type="date"
                  required
                  value={soldDate}
                  onChange={(e) => setSoldDate(e.target.value)}
                  max={today}
                  className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                />
              </div>

              <div>
                <label htmlFor="ms-price" className="block text-sm font-medium">
                  {t('price')} <span className="text-helper">({currency})</span>
                </label>
                <input
                  id="ms-price"
                  type="number"
                  step="1"
                  min="1"
                  value={soldPrice}
                  onChange={(e) => setSoldPrice(e.target.value)}
                  placeholder={t('pricePlaceholder')}
                  className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                />
                <p className="mt-1 text-xs text-helper">{t('priceHelp')}</p>
              </div>

              <div>
                <label htmlFor="ms-side" className="block text-sm font-medium">
                  {t('side')}
                </label>
                <select
                  id="ms-side"
                  value={side}
                  onChange={(e) => setSide(e.target.value as 'buyer' | 'seller' | 'both' | '')}
                  className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                >
                  <option value="">—</option>
                  <option value="buyer">{t('sideBuyer')}</option>
                  <option value="seller">{t('sideSeller')}</option>
                  <option value="both">{t('sideBoth')}</option>
                </select>
              </div>

              <div>
                <label htmlFor="ms-notes" className="block text-sm font-medium">
                  {t('notes')}
                </label>
                <textarea
                  id="ms-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('notesPlaceholder')}
                  maxLength={2000}
                  className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 text-sm text-red-600">
                {error === 'invalid_price'
                  ? t('errorInvalidPrice')
                  : error === 'forbidden'
                  ? t('errorForbidden')
                  : error === 'unauthenticated'
                  ? t('errorUnauthenticated')
                  : `${locale === 'es' ? 'Error' : 'Error'}: ${error}`}
              </p>
            )}

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="inline-flex h-9 items-center rounded-lg bg-blue-700 px-3 text-sm font-medium text-white shadow-whisper transition hover:bg-blue-800 disabled:opacity-50"
              >
                {pending ? '…' : t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
