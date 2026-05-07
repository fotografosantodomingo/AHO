import { PATHNAMES, type Locale } from '@/i18n/config';

/**
 * Re-localize a `/{locale}/...` path to a different locale using the
 * `PATHNAMES` mapping from `src/i18n/config.ts`.
 *
 * Use case: `/auth/callback` runs OUTSIDE the `[locale]` segment because
 * Supabase Auth doesn't know about our locale routing. The auth-email
 * templates (see `scripts/patch-supabase-email-links.ts`) hardcode an
 * EN-prefixed `next=...` query parameter. After we resolve the
 * authenticated user's preferred locale (`user_metadata.locale`),
 * this helper re-localizes the redirect path so a Spanish user lands on
 * `/es/restablecer-contrasena` instead of `/en/reset-password`.
 *
 * Pure function — edge-safe, no env access, no Supabase dependency.
 *
 * **Returns the input unchanged when:**
 *   - The path already matches the requested locale,
 *   - The path doesn't start with a recognized locale prefix,
 *   - The path's "rest" (after the locale) doesn't appear in
 *     `PATHNAMES` (we'd rather no-op than guess wrong on dynamic
 *     routes like `/properties/[slug]`).
 *
 * Best-effort + fail-soft: callers should never need to handle errors
 * — they get back either a translated path or the original.
 */
export function translatePathForLocale(
  safePath: string,
  userLocale: Locale,
): string {
  const m = safePath.match(/^\/(en|es)(\/.*)?$/);
  if (!m) return safePath;
  const currentLocale = m[1] as Locale;
  if (currentLocale === userLocale) return safePath;

  const rest = m[2] ?? '/';
  if (rest === '/') return `/${userLocale}`;

  for (const value of Object.values(PATHNAMES)) {
    if (typeof value === 'string') continue;
    // PATHNAMES values are now Record<Locale, string> covering all 7
    // locales. Index dynamically; the current/user locale are both
    // guaranteed to be valid Locale values from the regex match above
    // and the function signature respectively.
    const v = value as Record<Locale, string>;
    if (v[currentLocale] === rest) {
      return `/${userLocale}${v[userLocale]}`;
    }
  }
  return safePath;
}
