import 'server-only';
import { cookies } from 'next/headers';
import {
  getOrFetchUsdRates,
  convertCents,
  defaultCurrencyForLocale,
} from './rates';
import { formatPrice } from '@/lib/listings/format';
import type { Locale } from '@/i18n/config';

const CURRENCY_COOKIE = 'aho_currency';

/**
 * Server-side helpers for computing the approximate-converted price
 * label, used by Client Components (ListingCard) that can't read
 * cookies themselves.
 *
 * The pattern: server pages call `precomputeApproxLabels()` once for a
 * list of listings, get back a `{listingId → "≈ €240,000"} | null` map,
 * and pass each entry to the corresponding ListingCard via props. One
 * rate fetch per page render, regardless of card count.
 */

export async function getDisplayCurrency(locale: Locale): Promise<string> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(CURRENCY_COOKIE)?.value?.toUpperCase();
  return fromCookie || defaultCurrencyForLocale(locale);
}

interface ListingForApprox {
  id: string;
  priceCents: number;
  currency: string;
}

/**
 * Compute approximate-converted price labels for a batch of listings.
 * Single rate fetch per call; returns a Map of `listingId → label` for
 * listings whose source currency differs from the visitor's display
 * currency AND whose rate is available. Listings already in the
 * display currency, or unconvertible, are absent from the map.
 */
export async function precomputeApproxLabels(
  listings: ListingForApprox[],
  locale: Locale,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (listings.length === 0) return out;

  const target = await getDisplayCurrency(locale);

  // Short-circuit if every listing is already in the target currency —
  // saves the rate fetch entirely.
  const needsConversion = listings.some(
    (l) => l.currency.toUpperCase() !== target,
  );
  if (!needsConversion) return out;

  const cached = await getOrFetchUsdRates();
  if (!cached) return out;

  for (const listing of listings) {
    const source = listing.currency.toUpperCase();
    if (source === target) continue;
    const converted = convertCents(
      listing.priceCents,
      source,
      target,
      cached.rates,
    );
    if (converted == null) continue;
    out.set(listing.id, formatPrice(converted, target, locale));
  }
  return out;
}

/**
 * Single-listing variant for Server Components rendering a single
 * price (e.g., the property detail header). Returns null when no
 * conversion is needed or possible.
 */
export async function computeApproxLabel(
  priceCents: number,
  sourceCurrency: string,
  locale: Locale,
): Promise<string | null> {
  const target = await getDisplayCurrency(locale);
  const source = sourceCurrency.toUpperCase();
  if (source === target) return null;
  const cached = await getOrFetchUsdRates();
  if (!cached) return null;
  const converted = convertCents(priceCents, source, target, cached.rates);
  if (converted == null) return null;
  return formatPrice(converted, target, locale);
}
