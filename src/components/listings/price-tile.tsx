import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { formatPrice } from '@/lib/listings/format';
import {
  getOrFetchUsdRates,
  convertCents,
  defaultCurrencyForLocale,
} from '@/lib/currency/rates';

const COOKIE_NAME = 'aho_currency';

interface Props {
  priceCents: number;
  currency: string;
  locale: Locale;
  /** Optional period suffix ("/ month", "/ week"), already i18n'd. */
  periodLabel?: string;
  /** Visual variant. */
  size?: 'sm' | 'md' | 'lg';
  /** Class override for the outer wrapper. */
  className?: string;
}

/**
 * Worldwide-shaped price tile: source price (always) + converted
 * approximation in the visitor's preferred currency (when target ≠
 * source AND a usable rate is available).
 *
 * Server Component — reads the visitor's currency preference from a
 * cookie (set by the <CurrencyPicker> client component), fetches the
 * latest USD-base rate snapshot via `getOrFetchUsdRates()`, computes
 * the converted price, and renders.
 *
 * Failure modes (the tile NEVER throws or breaks the page):
 *   - No cookie → use locale default (USD)
 *   - Target equals source → render only the source
 *   - Rates unavailable (OXR down + no DB cache) → render only source
 *   - Quote currency missing from rate map → render only source
 *
 * The "≈" prefix on the converted line is the universal symbol for
 * "approximately" — readable in any locale without translation.
 *
 * Profile-based currency override (for signed-in users) is NOT read
 * here — adds a DB hit per render. The cookie is mirrored from the
 * profile by the picker on signin / change. The cookie is the source
 * of truth at render time.
 */
export async function PriceTile({
  priceCents,
  currency,
  locale,
  periodLabel,
  size = 'md',
  className,
}: Props) {
  const cookieStore = await cookies();
  const targetCurrency =
    cookieStore.get(COOKIE_NAME)?.value?.toUpperCase() ||
    defaultCurrencyForLocale(locale);

  const sourceCurrency = currency.toUpperCase();
  const sourceLabel = formatPrice(priceCents, sourceCurrency, locale);

  let convertedLabel: string | null = null;
  if (sourceCurrency !== targetCurrency) {
    const cached = await getOrFetchUsdRates();
    if (cached) {
      const converted = convertCents(
        priceCents,
        sourceCurrency,
        targetCurrency,
        cached.rates,
      );
      if (converted != null) {
        convertedLabel = formatPrice(converted, targetCurrency, locale);
      }
    }
  }

  const t = await getTranslations({ locale, namespace: 'priceTile' });

  const sizeClasses =
    size === 'lg'
      ? 'font-brand text-3xl font-bold tabular-nums tracking-tight md:text-[34px]'
      : size === 'sm'
        ? 'text-base font-semibold tabular-nums'
        : 'text-lg font-semibold tabular-nums';

  return (
    <div className={className}>
      <p className={sizeClasses}>
        {sourceLabel}
        {periodLabel && (
          <span className="ml-1 text-sm font-normal text-helper">
            {periodLabel}
          </span>
        )}
      </p>
      {convertedLabel && (
        <p
          className="mt-0.5 text-xs text-helper"
          aria-label={t('approximateInLabel', { value: convertedLabel })}
        >
          ≈ {convertedLabel}
        </p>
      )}
    </div>
  );
}

export const PRICE_TILE_COOKIE = COOKIE_NAME;
