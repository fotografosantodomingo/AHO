/**
 * Sanitize a `?next=` URL parameter for redirect-after-auth flows.
 *
 * Open-redirect defense: an attacker who can control the `next` param can
 * craft a link like `/signin?next=https://evil.example.com` and use the
 * legitimate AHO domain to bounce victims off-site immediately after
 * they sign in (or land on the page already signed in). To prevent this,
 * we only accept paths that:
 *   - start with `/` (relative to the AHO origin)
 *   - do NOT start with `//` (which is a protocol-relative URL — browsers
 *     resolve `//evil.com/foo` against the current scheme, taking the user
 *     off-site)
 *
 * Anything else falls back to the locale-aware home path.
 *
 * Pure function — edge-safe. Used by `/signin`, `/magic-link`, and any
 * other surface that takes a `?next=` query string.
 */
export function sanitizeNext(
  next: string | null | undefined,
  locale: string,
): string {
  if (!next) return `/${locale}`;
  if (!next.startsWith('/')) return `/${locale}`;
  if (next.startsWith('//')) return `/${locale}`;
  return next;
}
