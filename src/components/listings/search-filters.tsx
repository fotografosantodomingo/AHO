import { getTranslations } from 'next-intl/server';
import type { SearchFilters as Filters } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

interface Props {
  locale: Locale;
  filters: Filters;
}

/**
 * Server-rendered filter bar. Plain HTML form with `method="get"` —
 * submissions reload the page with new search params, which the server-side
 * search page reads + applies. No JS required for filtering.
 *
 * The form's `action` resolves to the localized search path so that submitting
 * filters preserves locale routing (e.g., on `/es/buscar` the form submits to
 * `/es/buscar?...`, not `/search?...`).
 */
export async function SearchFilters({ locale, filters }: Props) {
  const t = await getTranslations({ locale, namespace: 'search' });
  const tProperty = await getTranslations({ locale, namespace: 'property' });
  const action = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;

  return (
    <form
      method="get"
      action={action}
      className="grid gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800 md:grid-cols-6"
      role="search"
      aria-label={t('filtersHeading')}
    >
      <Field className="md:col-span-2">
        <label htmlFor="search-q" className="block text-xs uppercase tracking-wide text-zinc-500">
          {t('queryLabel')}
        </label>
        <input
          id="search-q"
          name="q"
          type="search"
          defaultValue={filters.q ?? ''}
          placeholder={t('queryPlaceholder')}
          className={inputClass}
        />
      </Field>

      <Field>
        <label htmlFor="search-city" className="block text-xs uppercase tracking-wide text-zinc-500">
          {t('cityLabel')}
        </label>
        <input
          id="search-city"
          name="city"
          type="text"
          defaultValue={filters.city ?? ''}
          className={inputClass}
        />
      </Field>

      <Field>
        <label htmlFor="search-transaction" className="block text-xs uppercase tracking-wide text-zinc-500">
          {t('transactionLabel')}
        </label>
        <select
          id="search-transaction"
          name="transaction"
          defaultValue={filters.transaction ?? ''}
          className={inputClass}
        >
          <option value="">{t('transactionAny')}</option>
          <option value="sale">{tProperty('transactionType.sale')}</option>
          <option value="rent">{tProperty('transactionType.rent')}</option>
          <option value="short_term">{tProperty('transactionType.short_term')}</option>
        </select>
      </Field>

      <Field>
        <label htmlFor="search-beds" className="block text-xs uppercase tracking-wide text-zinc-500">
          {t('bedroomsLabel')}
        </label>
        <select
          id="search-beds"
          name="beds_min"
          defaultValue={filters.bedsMin != null ? String(filters.bedsMin) : ''}
          className={inputClass}
        >
          <option value="">{t('bedsAny')}</option>
          <option value="1">1+</option>
          <option value="2">2+</option>
          <option value="3">3+</option>
          <option value="4">4+</option>
          <option value="5">5+</option>
        </select>
      </Field>

      <Field>
        <label
          htmlFor="search-min-price"
          className="block text-xs uppercase tracking-wide text-zinc-500"
        >
          {t('minPrice')}
        </label>
        <input
          id="search-min-price"
          name="min_price"
          type="number"
          min="0"
          step="100"
          defaultValue={filters.minPrice != null ? String(filters.minPrice) : ''}
          className={inputClass}
        />
      </Field>

      <Field>
        <label
          htmlFor="search-max-price"
          className="block text-xs uppercase tracking-wide text-zinc-500"
        >
          {t('maxPrice')}
        </label>
        <input
          id="search-max-price"
          name="max_price"
          type="number"
          min="0"
          step="100"
          defaultValue={filters.maxPrice != null ? String(filters.maxPrice) : ''}
          className={inputClass}
        />
      </Field>

      <div className="md:col-span-6 flex items-center gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('applyFilters')}
        </button>
        <a
          href={action}
          className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-4 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          {t('clearFilters')}
        </a>
      </div>
    </form>
  );
}

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100';

function Field({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
