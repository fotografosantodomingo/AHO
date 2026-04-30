/**
 * Pure formatting utilities for listings — split out of `seo.ts` so they
 * can be imported from Client Components.
 *
 * `seo.ts` carries `import 'server-only'` because most of its functions
 * fetch DB rows / build server-side metadata. `formatPrice` is just an
 * Intl call and is safe in any context. Re-exported from `seo.ts` for
 * backwards compatibility.
 */
import type { Locale } from '@/i18n/config';

/** Format an integer-cents price as a locale-aware currency string. */
export function formatPrice(
  amountCents: number,
  currency: string,
  locale: Locale,
): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountCents / 100);
}
