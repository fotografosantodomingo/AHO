import { describe, expect, it } from 'vitest';
import {
  parseFeatures,
  computeSectionPresence,
} from '@/lib/listings/features';

/**
 * Pins the `parseFeatures()` contract: drop-unknown-keys, coerce-bad-
 * types-to-undefined. Old listings with stale jsonb shapes shouldn't
 * break the property detail page.
 */

describe('parseFeatures', () => {
  it('returns an empty object for null/undefined/array input', () => {
    expect(parseFeatures(null)).toEqual({});
    expect(parseFeatures(undefined)).toEqual({});
    expect(parseFeatures([])).toEqual({});
    expect(parseFeatures('not an object')).toEqual({});
    expect(parseFeatures(42)).toEqual({});
  });

  it('keeps valid known keys and drops unknown keys', () => {
    const out = parseFeatures({
      parkingSpaces: 2,
      heatingFuel: 'gas',
      cooling: 'central',
      gated: true,
      not_a_real_field: 'ignored',
      __proto__: 'evil',
    });
    expect(out.parkingSpaces).toBe(2);
    expect(out.heatingFuel).toBe('gas');
    expect(out.cooling).toBe('central');
    expect(out.gated).toBe(true);
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['parkingSpaces', 'heatingFuel', 'cooling', 'gated']),
    );
    expect(out).not.toHaveProperty('not_a_real_field');
  });

  it('coerces wrong-type values to undefined', () => {
    const out = parseFeatures({
      parkingSpaces: 'two', // not a number
      heatingFuel: 'plutonium', // not a valid enum
      cooling: 999, // not a string
      gated: 'yes', // not a boolean
      stories: -1, // negative — drop
      lastRenovationYear: 1200, // out of bounds — drop
    });
    expect(out.parkingSpaces).toBeUndefined();
    expect(out.heatingFuel).toBeUndefined();
    expect(out.cooling).toBeUndefined();
    expect(out.gated).toBeUndefined();
    expect(out.stories).toBeUndefined();
    expect(out.lastRenovationYear).toBeUndefined();
  });

  it('parses string arrays, dropping empty/non-string entries', () => {
    const out = parseFeatures({
      flooring: ['hardwood', '', 42, '  tile  ', null],
      communityAmenities: ['pool', 'gym'],
    });
    expect(out.flooring).toEqual(['hardwood', 'tile']);
    expect(out.communityAmenities).toEqual(['pool', 'gym']);
  });

  it('parses listingTerms as a typed array', () => {
    const out = parseFeatures({
      listingTerms: ['cash', 'mortgage', 'invalid_term'],
    });
    expect(out.listingTerms).toEqual(['cash', 'mortgage']);
  });

  it('caps cents values at 13 digits (overflow protection)', () => {
    const tooBig = 99_999_999_999_999; // 14 digits
    const out = parseFeatures({
      hoaFeeCents: tooBig,
      propertyTaxAnnualCents: 12345,
    });
    expect(out.hoaFeeCents).toBeUndefined();
    expect(out.propertyTaxAnnualCents).toBe(12345);
  });

  it('rejects negative numbers', () => {
    const out = parseFeatures({
      parkingSpaces: -2,
      stories: 0, // 0 is valid (single-story rounded down? No — 0 stories means none); accept 0
      hoaFeeCents: -100,
    });
    expect(out.parkingSpaces).toBeUndefined();
    expect(out.stories).toBe(0);
    expect(out.hoaFeeCents).toBeUndefined();
  });
});

describe('computeSectionPresence', () => {
  it('reports interior=true when bedrooms is set even if features is empty', () => {
    const presence = computeSectionPresence({}, true, false);
    expect(presence.interior).toBe(true);
    expect(presence.property).toBe(false);
  });

  it('reports community=true when only hoaFeeCents is set', () => {
    const presence = computeSectionPresence(
      { hoaFeeCents: 50000 },
      false,
      false,
    );
    expect(presence.community).toBe(true);
  });

  it('all sections false when features empty and core flags false', () => {
    const presence = computeSectionPresence({}, false, false);
    for (const v of Object.values(presence)) expect(v).toBe(false);
  });

  it('boolean false counts as set (not undefined)', () => {
    // basement: false should mark property section as present
    const presence = computeSectionPresence({ basement: false }, false, false);
    expect(presence.property).toBe(true);
  });
});
