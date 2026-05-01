import type { Locale } from '@/i18n/config';

/**
 * Single source of truth for ISO-3166-1 alpha-2 → localized country name.
 * Replaces the four+ inline `resolveCountryName` / `Intl.DisplayNames` copies
 * that grew across `properties-in/`, `agents/`, `listing-card`, etc. The
 * underlying `Intl.DisplayNames` instance is created once per locale and
 * memoized so we don't pay the construction cost per render.
 *
 * Returns the uppercased ISO code unchanged if the runtime can't resolve
 * the region (older Edge runtimes, malformed input, etc.) — never throws.
 */
const cache = new Map<Locale, Intl.DisplayNames | null>();

function getDisplay(locale: Locale): Intl.DisplayNames | null {
  if (cache.has(locale)) return cache.get(locale)!;
  const intlLocale = locale === 'es' ? 'es-DO' : 'en-US';
  let display: Intl.DisplayNames | null;
  try {
    display = new Intl.DisplayNames([intlLocale], { type: 'region' });
  } catch {
    display = null;
  }
  cache.set(locale, display);
  return display;
}

export function getCountryName(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '';
  const code = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return code;
  const display = getDisplay(locale);
  return display?.of(code) ?? code;
}
