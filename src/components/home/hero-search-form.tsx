'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildCountryOptions } from '@/lib/listings/countries-iso';
import type { Locale } from '@/i18n/config';

type Transaction = 'sale' | 'rent';

interface CityOption {
  city: string;
  citySlug: string;
  listingCount: number;
}

interface Props {
  locale: Locale;
  searchPath: string;
  /**
   * Stem for the localized city-landing route, without country/city. ES
   * uses `/inmuebles-en`; the marketing locales share the EN stem
   * `/properties-in`. Caller resolves via `getPathname()` and passes
   * the locale-prefixed prefix here (e.g. `/en/properties-in`).
   */
  cityLandingStem: string;
  agentPath: string;
  submitLabel: string;
  tabBuyLabel: string;
  tabRentLabel: string;
  /** Localized aria-label for the Buy/Rent tablist. */
  transactionTabsLabel: string;
  agentLinkLabel: string;
  countryPlaceholder: string;
  cityPlaceholder: string;
  cityDisabledPlaceholder: string;
  cityLoadingPlaceholder: string;
}

/**
 * Homepage hero search form. Three-control layout per Phase 1B spec:
 *
 *     [ Buy | Rent ]   [ Country ▾ ]   [ City ▾ ]   [ Search ]   List as agent →
 *
 * Defaults to Buy. The City dropdown is disabled until a Country is chosen
 * — once one is, we fetch `/api/cities?country=XX` (5-min edge cache) and
 * populate it. Submitting GETs to /search with `transaction`, `country`,
 * and (optionally) `city` query params, so the URL is shareable + SEO-
 * friendly. The keyword input was removed in Phase 1B (place-driven
 * browse only on the hero; freeform `q` lives on the search page itself).
 */
export function HeroSearchForm({
  locale,
  searchPath,
  cityLandingStem,
  agentPath,
  submitLabel,
  tabBuyLabel,
  tabRentLabel,
  transactionTabsLabel,
  agentLinkLabel,
  countryPlaceholder,
  cityPlaceholder,
  cityDisabledPlaceholder,
  cityLoadingPlaceholder,
}: Props) {
  const [transaction, setTransaction] = useState<Transaction>('sale');
  const [country, setCountry] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [cities, setCities] = useState<CityOption[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);

  const countryOptions = useMemo(() => buildCountryOptions(locale), [locale]);

  useEffect(() => {
    setCity('');
    if (!country) {
      setCities([]);
      return;
    }
    let cancelled = false;
    setCitiesLoading(true);
    fetch(`/api/cities?country=${encodeURIComponent(country)}`, {
      credentials: 'omit',
    })
      .then((r) => (r.ok ? r.json() : { cities: [] }))
      .then((data: { cities?: CityOption[] }) => {
        if (cancelled) return;
        setCities(data.cities ?? []);
      })
      .catch(() => {
        if (!cancelled) setCities([]);
      })
      .finally(() => {
        if (!cancelled) setCitiesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // setCity / setCities / setCitiesLoading are stable useState setters;
    // react-hooks/exhaustive-deps does not flag them. Only `country` is
    // the real trigger here.
  }, [country]);

  const tabs: Array<{ value: Transaction; label: string }> = [
    { value: 'sale', label: tabBuyLabel },
    { value: 'rent', label: tabRentLabel },
  ];

  const cityPlaceholderLabel = !country
    ? cityDisabledPlaceholder
    : citiesLoading
    ? cityLoadingPlaceholder
    : cityPlaceholder;

  // When both country + city are picked, the right destination is the
  // city-landing surface (indexed, faster than /search) rather than a
  // /search?city=… query. Falling back to plain GET on /search keeps
  // the form working when JS hasn't hydrated yet (#31).
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!country || !city) return; // let the GET fall through
    e.preventDefault();
    const dest = `${cityLandingStem}/${country.toLowerCase()}/${city}?transaction=${transaction}`;
    window.location.assign(dest);
  }

  return (
    <form
      method="get"
      action={searchPath}
      role="search"
      onSubmit={onSubmit}
      className="mt-8 max-w-3xl"
    >
      <div
        role="tablist"
        aria-label={transactionTabsLabel}
        className="mb-3 inline-flex rounded-lg border border-border bg-surface/80 p-1 shadow-whisper backdrop-blur-sm dark:bg-surface-dark/80"
      >
        {tabs.map((tab) => {
          const active = transaction === tab.value;
          // Min-h-10 floor on mobile so each tab clears the comfortable
          // tap target. md+ relaxes to the original tighter rhythm.
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTransaction(tab.value)}
              className={
                active
                  ? 'inline-flex min-h-10 items-center rounded-md bg-action px-4 text-sm font-medium text-white shadow-whisper transition md:min-h-0 md:px-3.5 md:py-1.5 dark:bg-action-dark dark:text-surface-deep'
                  : 'inline-flex min-h-10 items-center rounded-md px-4 text-sm text-helper transition hover:text-action md:min-h-0 md:px-3.5 md:py-1.5 dark:hover:text-action-dark'
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <input type="hidden" name="transaction" value={transaction} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select
          name="country"
          aria-label={countryPlaceholder}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          className="block h-12 rounded-lg border border-border-strong bg-surface px-3 text-sm shadow-whisper outline-hidden transition focus:border-action focus:ring-3 focus:ring-action/30 dark:bg-surface-deep dark:focus:border-action-dark dark:focus:ring-action-dark/30"
        >
          <option value="">{countryPlaceholder}</option>
          {countryOptions.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.name}
            </option>
          ))}
        </select>

        <select
          name="city"
          aria-label={cityPlaceholder}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={!country || citiesLoading}
          className="block h-12 rounded-lg border border-border-strong bg-surface px-3 text-sm shadow-whisper outline-hidden transition focus:border-action focus:ring-3 focus:ring-action/30 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface-deep dark:focus:border-action-dark dark:focus:ring-action-dark/30"
        >
          <option value="">{cityPlaceholderLabel}</option>
          {cities.map((opt) => (
            <option key={opt.citySlug} value={opt.citySlug}>
              {opt.city}
              {opt.listingCount > 0 ? ` (${opt.listingCount})` : ''}
            </option>
          ))}
        </select>

        <button type="submit" className="btn-primary h-12 rounded-lg px-6">
          {submitLabel}
        </button>
      </div>

      <div className="mt-4">
        <a
          href={agentPath}
          className="text-sm text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
        >
          {agentLinkLabel} →
        </a>
      </div>
    </form>
  );
}
