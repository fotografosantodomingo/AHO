import { describe, it, expect } from 'vitest';
import { encodeBbox, parseBbox, type BboxView } from '@/lib/listings/bbox-url';

/**
 * Bbox URL-param encoding for the search page's panned-map view.
 *
 * Round-trip safety + strict validation matter because the parsed value
 * feeds straight into a public API call. Garbage in the URL must
 * degrade to "ignore the bbox param" not "fetch with NaN bounds".
 */

const NYC: BboxView = {
  swLat: 40.4774,
  swLng: -74.2591,
  neLat: 40.9176,
  neLng: -73.7004,
  zoom: 11,
};

describe('encodeBbox', () => {
  it('encodes a valid view as five comma-joined numbers', () => {
    expect(encodeBbox(NYC)).toBe('40.4774,-74.2591,40.9176,-73.7004,11');
  });

  it('rounds lat/lng to 5 decimals (sub-meter precision is irrelevant for map pan)', () => {
    expect(
      encodeBbox({
        swLat: 40.71234567,
        swLng: -74.00543210,
        neLat: 40.81234567,
        neLng: -73.90543210,
        zoom: 13,
      }),
    ).toBe('40.71235,-74.00543,40.81235,-73.90543,13');
  });

  it('rounds zoom to an integer', () => {
    expect(encodeBbox({ ...NYC, zoom: 11.4 })).toMatch(/,11$/);
    expect(encodeBbox({ ...NYC, zoom: 11.6 })).toMatch(/,12$/);
  });

  it('returns null when the south-west corner is north of the north-east corner', () => {
    expect(encodeBbox({ ...NYC, swLat: 50, neLat: 40 })).toBeNull();
  });

  it('returns null when the south-west corner is east of the north-east corner', () => {
    expect(encodeBbox({ ...NYC, swLng: -73, neLng: -74 })).toBeNull();
  });

  it('returns null for out-of-range latitude', () => {
    expect(encodeBbox({ ...NYC, swLat: -91 })).toBeNull();
    expect(encodeBbox({ ...NYC, neLat: 91 })).toBeNull();
  });

  it('returns null for out-of-range longitude', () => {
    expect(encodeBbox({ ...NYC, swLng: -181 })).toBeNull();
    expect(encodeBbox({ ...NYC, neLng: 181 })).toBeNull();
  });

  it('returns null for out-of-range zoom', () => {
    expect(encodeBbox({ ...NYC, zoom: -1 })).toBeNull();
    expect(encodeBbox({ ...NYC, zoom: 21 })).toBeNull();
  });

  it('returns null for non-finite numbers', () => {
    expect(encodeBbox({ ...NYC, swLat: Number.NaN })).toBeNull();
    expect(encodeBbox({ ...NYC, neLng: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

describe('parseBbox', () => {
  it('parses a well-formed five-number string', () => {
    expect(parseBbox('40.4774,-74.2591,40.9176,-73.7004,11')).toEqual({
      swLat: 40.4774,
      swLng: -74.2591,
      neLat: 40.9176,
      neLng: -73.7004,
      zoom: 11,
    });
  });

  it('round-trips an encoded view', () => {
    const encoded = encodeBbox(NYC);
    expect(encoded).not.toBeNull();
    const parsed = parseBbox(encoded);
    expect(parsed).toEqual(NYC);
  });

  it('returns null for empty / null / undefined input', () => {
    expect(parseBbox(null)).toBeNull();
    expect(parseBbox(undefined)).toBeNull();
    expect(parseBbox('')).toBeNull();
  });

  it('returns null for the wrong number of parts', () => {
    expect(parseBbox('40,40,40,40')).toBeNull();
    expect(parseBbox('40,40,40,40,40,40')).toBeNull();
  });

  it('returns null for non-numeric parts', () => {
    expect(parseBbox('foo,-74,40,-73,11')).toBeNull();
    expect(parseBbox('40,-74,40,-73,bar')).toBeNull();
  });

  it('returns null for inverted corners (defensive — the bbox API also rejects these, but degrading at the URL boundary spares a round-trip)', () => {
    expect(parseBbox('50,-74,40,-73,11')).toBeNull();
    expect(parseBbox('40,-73,40,-74,11')).toBeNull();
  });

  it('returns null for out-of-range values', () => {
    expect(parseBbox('-91,-74,40,-73,11')).toBeNull();
    expect(parseBbox('40,-181,40,-73,11')).toBeNull();
    expect(parseBbox('40,-74,40,-73,-1')).toBeNull();
    expect(parseBbox('40,-74,40,-73,21')).toBeNull();
  });
});
