/**
 * Org slug helper. Pure function — unit-testable without DB access.
 *
 * Rules:
 *   - Lowercase
 *   - ASCII alphanumeric + hyphens only
 *   - Strip diacritics (Spanish names like "Inmobiliaria Núñez" → "inmobiliaria-nunez")
 *   - Collapse whitespace and runs of hyphens
 *   - Trim leading/trailing hyphens
 *   - Cap at 60 chars (DB has no limit but URL length matters for SEO)
 *
 * Empty input or input that strips to nothing returns 'org' as a fallback;
 * uniqueness is enforced by the caller appending a numeric suffix on
 * collision.
 */
export function slugifyOrgName(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // drop everything not alnum/space/hyphen
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || 'org';
}
