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

  // Count of non-default filter values, used to show a subtle "X filters
  // active" pill and to gate visibility of the Clear button. Page param
  // is excluded — it's pagination, not a filter.
  const activeCount = [
    filters.q,
    filters.city,
    filters.country,
    filters.transaction,
    filters.minPrice,
    filters.maxPrice,
    filters.bedsMin,
  ].filter((v) => v != null && v !== '').length;

  return (
    <form
      method="get"
      action={action}
      className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep md:grid-cols-4"
      role="search"
      aria-label={t('filtersHeading')}
    >
      <Field>
        <label htmlFor="search-q" className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
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
        <label htmlFor="search-city" className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
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
        <label
          htmlFor="search-country"
          className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
        >
          {t('countryLabel')}
        </label>
        <input
          id="search-country"
          name="country"
          type="text"
          inputMode="text"
          maxLength={2}
          autoCapitalize="characters"
          placeholder={t('countryPlaceholder')}
          defaultValue={filters.country ?? ''}
          className={`${inputClass} uppercase`}
        />
      </Field>

      <Field>
        <label htmlFor="search-transaction" className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
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
        <label htmlFor="search-beds" className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
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
          className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
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
          className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
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

      <div className="md:col-span-4 flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-lg bg-surface-dark px-4 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
        >
          {t('applyFilters')}
        </button>
        {activeCount > 0 && (
          <>
            <a
              href={action}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
            >
              {t('clearFilters')}
            </a>
            <span className="ml-auto inline-flex items-center rounded-full bg-action/10 px-2.5 py-0.5 text-xs font-medium text-action dark:bg-action-dark/15 dark:text-action-dark">
              {activeCount === 1
                ? locale === 'es'
                  ? '1 filtro activo'
                  : '1 filter active'
                : locale === 'es'
                ? `${activeCount} filtros activos`
                : `${activeCount} filters active`}
            </span>
          </>
        )}
      </div>
    </form>
  );
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden transition focus:border-action focus:ring-3 focus:ring-action/30 dark:bg-surface-deep dark:focus:border-action-dark dark:focus:ring-action-dark/30';

function Field({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className}>{children}</div>;
}
