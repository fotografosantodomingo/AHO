/**
 * Property amenities catalog. Stored as a `text[]` of canonical lowercase
 * keys in `properties.amenities`. The display label is rendered at form
 * time via i18n, so the database value stays stable + locale-agnostic.
 *
 * Order is loosely "what most listings will check first" → less-common at
 * the end. Keep this list reasonably small (12 fits a 4-col grid in two
 * rows on desktop, 2 cols × 6 rows on mobile).
 */
export const AMENITY_KEYS = [
  'parking',
  'pool',
  'garden',
  'terrace',
  'balcony',
  'jacuzzi',
  'gym',
  'security',
  'air_conditioning',
  'furnished',
  'pet_friendly',
  'basement',
] as const;

export type AmenityKey = (typeof AMENITY_KEYS)[number];

export function isAmenityKey(value: unknown): value is AmenityKey {
  return typeof value === 'string' && (AMENITY_KEYS as readonly string[]).includes(value);
}
