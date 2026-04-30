'use client';

import { useState } from 'react';

type Transaction = '' | 'sale' | 'rent';

interface Props {
  searchPath: string;
  placeholder: string;
  submitLabel: string;
  tabAnyLabel: string;
  tabBuyLabel: string;
  tabRentLabel: string;
}

/**
 * Homepage hero search form. A small upgrade over the old plain-input form:
 * a pill toggle for transaction type sits above the keyword input. The form
 * still GETs to /search so URLs are shareable + SEO-friendly. The hidden
 * `transaction` input only ships when a non-Any tab is active so the URL
 * doesn't carry an empty param.
 */
export function HeroSearchForm({
  searchPath,
  placeholder,
  submitLabel,
  tabAnyLabel,
  tabBuyLabel,
  tabRentLabel,
}: Props) {
  const [transaction, setTransaction] = useState<Transaction>('');

  const tabs: Array<{ value: Transaction; label: string }> = [
    { value: '', label: tabAnyLabel },
    { value: 'sale', label: tabBuyLabel },
    { value: 'rent', label: tabRentLabel },
  ];

  return (
    <form
      method="get"
      action={searchPath}
      role="search"
      className="mt-8 max-w-xl"
    >
      <div
        role="tablist"
        aria-label="Transaction type"
        className="mb-3 inline-flex rounded-lg border border-border bg-surface/80 p-1 shadow-whisper backdrop-blur-sm dark:bg-surface-dark/80"
      >
        {tabs.map((tab) => {
          const active = transaction === tab.value;
          return (
            <button
              key={tab.value || 'any'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTransaction(tab.value)}
              className={
                active
                  ? 'rounded-md bg-surface-dark px-3.5 py-1.5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition dark:bg-surface dark:text-ink'
                  : 'rounded-md px-3.5 py-1.5 text-sm text-helper transition hover:text-ink dark:hover:text-ink-inverse'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="search"
          name="q"
          placeholder={placeholder}
          aria-label={placeholder}
          className="block flex-1 rounded-lg border border-border-strong bg-surface px-4 py-3 text-sm shadow-whisper outline-hidden transition focus:border-action focus:ring-3 focus:ring-action/30 dark:bg-surface-deep dark:focus:border-action-dark dark:focus:ring-action-dark/30"
        />
        {transaction !== '' && (
          <input type="hidden" name="transaction" value={transaction} />
        )}
        <button
          type="submit"
          className="inline-flex items-center rounded-lg bg-surface-dark px-6 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
