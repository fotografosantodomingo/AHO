/**
 * Typed shape for `properties.features` jsonb. Lives here as the contract
 * between the listing form, the PATCH endpoint, the property detail page's
 * Facts & Features sections, and (eventually) the search filters.
 *
 * Storage choice: jsonb on `properties` (not separate columns) per the v1
 * scope-vs-flexibility tradeoff documented in DECISIONS 2026-05-01:
 *   - Each new F&F field would be a migration if separate-column.
 *   - jsonb keeps the schema stable; the type discipline lives here.
 *   - Searchable fields (e.g., HOA fee bracket, parking required) get
 *     promoted to columns when search filters demand them. v1.1+.
 *
 * Worldwide labels: every field uses a locale-neutral label rendered via
 * the `property.features.*` i18n keys. No country-specific aliases (no
 * "HOA" → "strata" branching). Keys are stable across markets.
 *
 * Validation: `parseFeatures()` accepts unknown jsonb input and returns
 * a typed `PropertyFeatures` with all-optional fields. Unknown / wrong-
 * type values are silently dropped — old listings with stale shapes
 * don't break the page.
 */

export type ParkingType = 'garage' | 'carport' | 'street' | 'lot' | 'none';
export type HeatingFuel = 'electric' | 'gas' | 'oil' | 'solar' | 'wood' | 'none';
export type CoolingType = 'central' | 'split' | 'window' | 'evaporative' | 'none';
export type WaterSource = 'public' | 'well' | 'cistern' | 'truck';
export type SewerType = 'public' | 'septic' | 'none';
export type HoaFeePeriod = 'monthly' | 'annual';
export type PetPolicy = 'allowed' | 'restricted' | 'none';
export type ListingTerm = 'cash' | 'mortgage' | 'owner_financing' | 'lease_to_own' | 'trade';

/**
 * Full F&F shape. ALL fields optional — empty fields hide from the
 * detail-page rendering, empty sections collapse entirely. There's
 * no "required field" concept; an agent can publish a listing with
 * just price + title + city + country.
 */
export interface PropertyFeatures {
  // Interior
  parkingSpaces?: number;
  parkingType?: ParkingType;
  flooring?: string[]; // free-form tags (hardwood, tile, ...)
  heatingFuel?: HeatingFuel;
  cooling?: CoolingType;
  laundryInUnit?: boolean;
  furnished?: boolean;
  balcony?: boolean;
  terrace?: boolean;

  // Property
  stories?: number;
  basement?: boolean;
  petPolicy?: PetPolicy;
  lastRenovationYear?: number;

  // Construction
  exteriorMaterial?: string;
  roofType?: string;

  // Utilities
  water?: WaterSource;
  sewer?: SewerType;
  solar?: boolean;

  // Community / HOA
  hoaFeeCents?: number; // bigint stored as number; null/undefined = no fee
  hoaFeePeriod?: HoaFeePeriod;
  gated?: boolean;
  securitySystem?: boolean;
  communityAmenities?: string[]; // pool, gym, beach access, etc. (separate from per-unit amenities)

  // Location
  schoolDistrict?: string;
  distanceToBeachMeters?: number;
  publicTransitNearby?: boolean;

  // Financial
  propertyTaxAnnualCents?: number;
  listingTerms?: ListingTerm[];
}

const PARKING_TYPES: readonly ParkingType[] = [
  'garage',
  'carport',
  'street',
  'lot',
  'none',
];
const HEATING_FUELS: readonly HeatingFuel[] = [
  'electric',
  'gas',
  'oil',
  'solar',
  'wood',
  'none',
];
const COOLING_TYPES: readonly CoolingType[] = [
  'central',
  'split',
  'window',
  'evaporative',
  'none',
];
const WATER_SOURCES: readonly WaterSource[] = ['public', 'well', 'cistern', 'truck'];
const SEWER_TYPES: readonly SewerType[] = ['public', 'septic', 'none'];
const HOA_PERIODS: readonly HoaFeePeriod[] = ['monthly', 'annual'];
const PET_POLICIES: readonly PetPolicy[] = ['allowed', 'restricted', 'none'];
const LISTING_TERMS: readonly ListingTerm[] = [
  'cash',
  'mortgage',
  'owner_financing',
  'lease_to_own',
  'trade',
];

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.trunc(value);
  return n >= 0 ? n : undefined;
}

function asYear(value: unknown): number | undefined {
  const n = asPositiveInt(value);
  if (n == null) return undefined;
  // Sanity bounds — anything outside is almost certainly bad data.
  if (n < 1500 || n > 2100) return undefined;
  return n;
}

function asPositiveBigCents(value: unknown): number | undefined {
  // Up to ~99 trillion — overflow-safe for property prices.
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.trunc(value);
  return n >= 0 && n <= 9_999_999_999_999 ? n : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= 100);
  return out.length > 0 ? out : undefined;
}

function asTrimmedString(value: unknown, max = 200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return undefined;
  return t;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Parse a raw jsonb (or any unknown shape) into a typed PropertyFeatures.
 * Drops unknown keys; coerces wrong types to `undefined`. Safe to feed
 * arbitrary input — never throws.
 */
export function parseFeatures(raw: unknown): PropertyFeatures {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: PropertyFeatures = {};

  // Interior
  const parkingSpaces = asPositiveInt(r.parkingSpaces);
  if (parkingSpaces != null) out.parkingSpaces = parkingSpaces;
  if (isOneOf(r.parkingType, PARKING_TYPES)) out.parkingType = r.parkingType;
  const flooring = asStringArray(r.flooring);
  if (flooring) out.flooring = flooring;
  if (isOneOf(r.heatingFuel, HEATING_FUELS)) out.heatingFuel = r.heatingFuel;
  if (isOneOf(r.cooling, COOLING_TYPES)) out.cooling = r.cooling;
  const laundryInUnit = asBoolean(r.laundryInUnit);
  if (laundryInUnit !== undefined) out.laundryInUnit = laundryInUnit;
  const furnished = asBoolean(r.furnished);
  if (furnished !== undefined) out.furnished = furnished;
  const balcony = asBoolean(r.balcony);
  if (balcony !== undefined) out.balcony = balcony;
  const terrace = asBoolean(r.terrace);
  if (terrace !== undefined) out.terrace = terrace;

  // Property
  const stories = asPositiveInt(r.stories);
  if (stories != null) out.stories = stories;
  const basement = asBoolean(r.basement);
  if (basement !== undefined) out.basement = basement;
  if (isOneOf(r.petPolicy, PET_POLICIES)) out.petPolicy = r.petPolicy;
  const lastRenovationYear = asYear(r.lastRenovationYear);
  if (lastRenovationYear != null) out.lastRenovationYear = lastRenovationYear;

  // Construction
  const exteriorMaterial = asTrimmedString(r.exteriorMaterial, 100);
  if (exteriorMaterial) out.exteriorMaterial = exteriorMaterial;
  const roofType = asTrimmedString(r.roofType, 100);
  if (roofType) out.roofType = roofType;

  // Utilities
  if (isOneOf(r.water, WATER_SOURCES)) out.water = r.water;
  if (isOneOf(r.sewer, SEWER_TYPES)) out.sewer = r.sewer;
  const solar = asBoolean(r.solar);
  if (solar !== undefined) out.solar = solar;

  // Community / HOA
  const hoaFeeCents = asPositiveBigCents(r.hoaFeeCents);
  if (hoaFeeCents != null) out.hoaFeeCents = hoaFeeCents;
  if (isOneOf(r.hoaFeePeriod, HOA_PERIODS)) out.hoaFeePeriod = r.hoaFeePeriod;
  const gated = asBoolean(r.gated);
  if (gated !== undefined) out.gated = gated;
  const securitySystem = asBoolean(r.securitySystem);
  if (securitySystem !== undefined) out.securitySystem = securitySystem;
  const communityAmenities = asStringArray(r.communityAmenities);
  if (communityAmenities) out.communityAmenities = communityAmenities;

  // Location
  const schoolDistrict = asTrimmedString(r.schoolDistrict, 200);
  if (schoolDistrict) out.schoolDistrict = schoolDistrict;
  const distanceToBeachMeters = asPositiveInt(r.distanceToBeachMeters);
  if (distanceToBeachMeters != null) out.distanceToBeachMeters = distanceToBeachMeters;
  const publicTransitNearby = asBoolean(r.publicTransitNearby);
  if (publicTransitNearby !== undefined) out.publicTransitNearby = publicTransitNearby;

  // Financial
  const propertyTaxAnnualCents = asPositiveBigCents(r.propertyTaxAnnualCents);
  if (propertyTaxAnnualCents != null) out.propertyTaxAnnualCents = propertyTaxAnnualCents;
  if (Array.isArray(r.listingTerms)) {
    const terms = r.listingTerms.filter((v): v is ListingTerm =>
      isOneOf(v, LISTING_TERMS),
    );
    if (terms.length > 0) out.listingTerms = terms;
  }

  return out;
}

/**
 * Determine which Facts & Features sections have at least one non-empty
 * field. Used to collapse empty sections on the property detail page.
 */
export interface SectionPresence {
  interior: boolean;
  property: boolean;
  construction: boolean;
  utilities: boolean;
  community: boolean;
  location: boolean;
  financial: boolean;
}

export function computeSectionPresence(
  f: PropertyFeatures,
  hasCoreInterior: boolean, // bedrooms || bathrooms || areaSqm — stored on the row, not in features
  hasCoreProperty: boolean, // lotSizeSqm || yearBuilt || propertyType
): SectionPresence {
  return {
    interior:
      hasCoreInterior ||
      f.parkingSpaces != null ||
      f.parkingType != null ||
      (f.flooring?.length ?? 0) > 0 ||
      f.heatingFuel != null ||
      f.cooling != null ||
      f.laundryInUnit !== undefined ||
      f.furnished !== undefined ||
      f.balcony !== undefined ||
      f.terrace !== undefined,
    property:
      hasCoreProperty ||
      f.stories != null ||
      f.basement !== undefined ||
      f.petPolicy != null ||
      f.lastRenovationYear != null,
    construction:
      f.exteriorMaterial != null || f.roofType != null,
    utilities:
      f.water != null || f.sewer != null || f.solar !== undefined,
    community:
      f.hoaFeeCents != null ||
      f.gated !== undefined ||
      f.securitySystem !== undefined ||
      (f.communityAmenities?.length ?? 0) > 0,
    location:
      f.schoolDistrict != null ||
      f.distanceToBeachMeters != null ||
      f.publicTransitNearby !== undefined,
    financial:
      f.propertyTaxAnnualCents != null || (f.listingTerms?.length ?? 0) > 0,
  };
}
