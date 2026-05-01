/**
 * Listing slug builder — pure function, edge-safe, no env access.
 *
 * Format: `{title} {city} {country}` lowercased + diacritic-stripped +
 * non-alphanumeric removed + collapsed whitespace → hyphens, capped at
 * 60 chars. Empty input falls back to the literal `'listing'` so the
 * slug-suffix loop in the listing URL (`{slug}-{shortId}`) always has
 * something to attach.
 *
 * Stability rule (per `src/app/api/listings/[id]/route.ts` PATCH docstring):
 * once a listing is published with a slug, that slug is locked — title
 * changes do NOT regenerate it. The PATCH route only fills slugs in
 * locales that were previously null (e.g. an EN-only listing later gets
 * a Spanish title; we generate the missing `slug_es` so `/es/propiedades/...`
 * resolves).
 *
 * Single source of truth — replaces the three previous private copies in
 * `lib/listings/actions.ts`, `app/api/listings/route.ts`, and (newly added)
 * the PATCH path.
 */
export function slugifyListing(
  title: string,
  city: string,
  country: string,
): string {
  const base = `${title} ${city} ${country}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'listing';
}
