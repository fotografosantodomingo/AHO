import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './config';

/**
 * Per-request i18n config.
 *
 * Messages are deep-merged with English as fallback so the v1 marketing
 * locales (PL/PT/DE/FR/IT) can ship by translating just the namespaces
 * that matter for SEO (the agent-acquisition landing pages, plus any
 * site chrome we hand-translate over time) — every untranslated key
 * gracefully renders the English string instead of the missing-key
 * placeholder.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = LOCALES.includes(requested as Locale)
    ? (requested as Locale)
    : DEFAULT_LOCALE;

  const enMessages = (await import(`../../messages/en.json`)).default;
  const localeMessages =
    locale === 'en'
      ? {}
      : (await import(`../../messages/${locale}.json`)).default;

  return {
    locale,
    messages: deepMerge(
      enMessages as Record<string, unknown>,
      localeMessages as Record<string, unknown>,
    ),
  };
});

/**
 * Deep-merge two JSON-like objects. Override wins on overlap. Arrays
 * are replaced wholesale (we don't have any localized-array structures
 * where partial-array fallback would make sense).
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] !== null &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
