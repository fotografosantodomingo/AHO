import { describe, it, expect } from 'vitest';
import { slugifyListing } from '@/lib/listings/slug';

/**
 * Listing slug builder. Two consumer paths:
 *   1. POST /api/listings — generates slug_en / slug_es at create time
 *      from title + city + country.
 *   2. PATCH /api/listings/:id — fills a previously-null slug when the
 *      agent later adds a title in that locale (locale-fill rule).
 *
 * Bug fixed alongside this test: PATCH used to leave slug_es=null even
 * after adding title_es to an EN-only listing, leaving the listing with
 * no Spanish URL.
 */

describe('slugifyListing', () => {
  it('produces a hyphenated lowercase slug from title + city + country', () => {
    expect(slugifyListing('Modern Villa', 'Santo Domingo', 'DO')).toBe(
      'modern-villa-santo-domingo-do',
    );
  });

  it('strips diacritics (Spanish accents, ñ, etc.)', () => {
    expect(slugifyListing('Casa Cómoda', 'Cádiz', 'ES')).toBe(
      'casa-comoda-cadiz-es',
    );
  });

  it('strips non-alphanumeric characters except hyphens and spaces, then collapses', () => {
    expect(slugifyListing('Beach House! @ The Cove (3BR)', 'Miami', 'US')).toBe(
      'beach-house-the-cove-3br-miami-us',
    );
  });

  it('collapses runs of whitespace and hyphens to a single hyphen', () => {
    expect(slugifyListing('  Modern    Villa   ', 'Santo Domingo', 'DO')).toBe(
      'modern-villa-santo-domingo-do',
    );
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugifyListing('-Modern Villa-', 'Santo Domingo', 'DO')).toBe(
      'modern-villa-santo-domingo-do',
    );
  });

  it('caps the slug at 60 characters', () => {
    const long = 'A'.repeat(120);
    const slug = slugifyListing(long, 'Santo Domingo', 'DO');
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('falls back to "listing" when the input produces an empty slug', () => {
    expect(slugifyListing('', '', '')).toBe('listing');
    expect(slugifyListing('!!!', '???', '###')).toBe('listing');
  });

  it('handles Cyrillic / non-Latin characters by stripping them', () => {
    // Non-Latin scripts get removed entirely after diacritic-strip; the
    // city + country still carry SEO weight.
    expect(slugifyListing('Дом', 'Moscow', 'RU')).toBe('moscow-ru');
  });

  it('is deterministic — same input always produces same slug', () => {
    const a = slugifyListing('Modern Villa', 'Santo Domingo', 'DO');
    const b = slugifyListing('Modern Villa', 'Santo Domingo', 'DO');
    expect(a).toBe(b);
  });
});
