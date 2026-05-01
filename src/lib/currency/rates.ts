import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';

/**
 * Worldwide FX rate cache for the price-tile converter.
 *
 * Source: openexchangerates.org (free tier — USD base only, 1000
 * requests/month). The free tier's URL is `https://openexchangerates.org/
 * api/latest.json?app_id=...&base=USD` and returns
 * `{ base, rates: { USD: 1, EUR: 0.92, DOP: 60.45, ... } }`.
 *
 * Caching:
 *   - DB row: `currency_rate_snapshot` keyed on `base_currency='USD'`
 *   - Refresh policy: 24h. When `fetched_at < now() - 24h`, the next
 *     read triggers a background fetch via the service-role admin
 *     client.
 *   - Concurrent refresh races are race-safe because the upsert is
 *     idempotent on the PK; both winners write the same payload.
 *
 * Failure modes (worldwide-shaped — the converter NEVER throws):
 *   - OXR API down + cache stale → return stale rates anyway, log warn
 *   - OXR API down + cache empty → return null; caller renders source
 *     currency only
 *   - OPENEXCHANGERATES_APP_ID unset → return null; converter no-ops
 *   - Unknown quote currency → convertCents returns null; caller falls
 *     back to source price
 */

const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_OK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // serve stale up to 7d if API down

const BASE_CURRENCY = 'USD';

interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: string;
  /** Rates more than 24h old should trigger a refresh; > 7d → don't trust at all. */
  isFresh: boolean;
  isUsable: boolean;
}

/**
 * Fetch the latest USD-base rate snapshot from cache or, if stale,
 * refresh from OXR. Always returns the most-recent rates we have, with
 * `isFresh` indicating whether they're within the 24h window.
 *
 * Reads use the user-context Supabase client (RLS allows anon SELECT
 * on currency_rate_snapshot per 0017). Refresh writes use the service-
 * role admin client because no user-context INSERT/UPDATE policy exists.
 */
export async function getOrFetchUsdRates(): Promise<CachedRates | null> {
  const supabase = await createServerSupabaseClient();
  const { data: cached } = await supabase
    .from('currency_rate_snapshot')
    .select('rates, fetched_at')
    .eq('base_currency', BASE_CURRENCY)
    .maybeSingle();

  const now = Date.now();
  const cachedAt = cached ? new Date(cached.fetched_at as string).getTime() : 0;
  const cacheAge = now - cachedAt;
  const isFresh = !!cached && cacheAge < REFRESH_TTL_MS;
  const isUsable = !!cached && cacheAge < STALE_OK_TTL_MS;

  if (isFresh) {
    return {
      rates: cached!.rates as Record<string, number>,
      fetchedAt: cached!.fetched_at as string,
      isFresh: true,
      isUsable: true,
    };
  }

  // Try to refresh. If the refresh fails AND we have a stale-but-usable
  // cache, return that. Otherwise return null (caller falls back to
  // showing only the source price).
  const fresh = await fetchFromOxr().catch((err) => {
    console.warn('[currency/rates] OXR fetch failed', err);
    return null;
  });
  if (fresh) {
    await persistRates(fresh.rates).catch((err) => {
      console.warn('[currency/rates] persist failed', err);
    });
    return {
      rates: fresh.rates,
      fetchedAt: new Date().toISOString(),
      isFresh: true,
      isUsable: true,
    };
  }

  if (cached && isUsable) {
    return {
      rates: cached.rates as Record<string, number>,
      fetchedAt: cached.fetched_at as string,
      isFresh: false,
      isUsable: true,
    };
  }

  return null;
}

async function fetchFromOxr(): Promise<{ rates: Record<string, number> } | null> {
  const env = serverEnv();
  if (!env.OPENEXCHANGERATES_APP_ID) {
    return null;
  }
  const url = `https://openexchangerates.org/api/latest.json?app_id=${encodeURIComponent(
    env.OPENEXCHANGERATES_APP_ID,
  )}&base=${BASE_CURRENCY}`;
  const res = await fetch(url, {
    // Edge-runtime fetch supports cf-flavor cache directives but plain
    // 'no-store' avoids any layered caching.
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`OXR HTTP ${res.status}`);
  }
  const json = (await res.json()) as { rates?: Record<string, number> };
  if (!json?.rates || typeof json.rates !== 'object') {
    throw new Error('OXR malformed response');
  }
  // Sanity-floor: USD must equal 1.0 in a USD-base snapshot.
  if (Math.abs((json.rates.USD ?? 0) - 1) > 0.0001) {
    throw new Error('OXR USD≠1 in USD-base response');
  }
  return { rates: json.rates };
}

async function persistRates(rates: Record<string, number>): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('currency_rate_snapshot').upsert(
    {
      base_currency: BASE_CURRENCY,
      rates,
      source: 'openexchangerates',
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'base_currency' },
  );
  if (error) throw error;
}

/**
 * Convert an integer cents amount from one ISO-4217 currency to another.
 * Returns null when the conversion can't be done (unknown currency, no
 * rate available). Callers should fall back to rendering the source
 * currency only.
 *
 * Math: rates are quoted relative to USD. To convert FROM → TO:
 *   amount_in_to = amount_in_from * (rates[TO] / rates[FROM])
 * Same-currency conversion is a no-op (returns input unchanged).
 */
export function convertCents(
  cents: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number | null {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return cents;
  const fromRate = rates[f];
  const toRate = rates[t];
  if (!fromRate || !toRate || !Number.isFinite(fromRate) || !Number.isFinite(toRate)) {
    return null;
  }
  // OXR rates are 1 USD = X.X CURRENCY. So USD/x converts to-cents into
  // base USD-cents, then * y converts USD-cents → to-cents.
  const usdCents = cents / fromRate;
  const out = Math.round(usdCents * toRate);
  return Number.isFinite(out) ? out : null;
}

/**
 * Convenience: short list of common quote currencies for the
 * `<CurrencyPicker>` dropdown. Order is "most likely to be useful at
 * AHO's anchor markets". Add as more markets open.
 */
export const COMMON_CURRENCIES = [
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

export type CommonCurrency = (typeof COMMON_CURRENCIES)[number];

/**
 * Default display currency for an anon visitor — locale-derived.
 * Authenticated users override via `profiles.preferred_currency`.
 *
 * Worldwide-shaped: every locale has a sensible default that doesn't
 * surprise the visitor (no "show me Argentine pesos by default" if I
 * land on /en).
 */
export function defaultCurrencyForLocale(locale: 'en' | 'es'): string {
  // Both locales default to USD because:
  //   - en speakers split across US/UK/Canada/Australia; USD is the
  //     real estate cross-border default
  //   - es speakers in DR (anchor) use USD for property pricing already
  // The picker is the override path for anyone who wants something else.
  return locale === 'en' ? 'USD' : 'USD';
}
