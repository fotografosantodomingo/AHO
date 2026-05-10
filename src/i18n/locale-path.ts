import { PATHNAMES, type Locale } from './config';

/**
 * Pure path-resolver that mirrors the behavior of next-intl's
 * `getPathname({ href, locale })` but without pulling
 * `next-intl/navigation` (which in turn imports `next/navigation`).
 * That import chain breaks the Vitest unit harness; this module is
 * safe to use from `lib/` code that gets unit-tested.
 *
 * Builds a fully locale-prefixed href string from a canonical
 * (English-shaped) path. Used to replace the long-form
 * `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}` ternary
 * scattered across the codebase (QA report 2026-05-10 P1 #7); a new
 * translated segment in PATHNAMES propagates automatically instead of
 * needing a code-grep.
 *
 * For dynamic routes (e.g. `/dashboard/properties/[id]`), pass the
 * canonical href with the bracket placeholders intact and interpolate
 * the actual id after this function returns.
 *
 * @example
 *   localePath('es', '/pricing')       // '/es/precios'
 *   localePath('pl', '/saved-searches')// '/pl/saved-searches' (marketing locale = EN slug)
 *   localePath('en', '/dashboard')     // '/en/dashboard'
 *   localePath('es', '/admin/users')   // '/es/admin/users' (single-string PATHNAME)
 */
export function localePath(locale: Locale, href: string): string {
  const entry = (PATHNAMES as Record<string, string | Record<Locale, string>>)[href];
  // Unregistered href — return the raw concatenation so the caller
  // doesn't silently 404; surface the bug instead.
  if (entry === undefined) return `/${locale}${href}`;
  if (typeof entry === 'string') return `/${locale}${entry}`;
  return `/${locale}${entry[locale]}`;
}
