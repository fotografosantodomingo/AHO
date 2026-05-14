/**
 * Unit tests for `src/lib/social/post-formatter.ts` — Phase C of
 * docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * Per the `social-platform-integration` skill step #5: "Add unit tests
 * for known edge cases (long titles, missing fields, non-Latin
 * characters, empty amenities)."
 */

import { describe, expect, it } from 'vitest';
import {
  cityHashtag,
  clamp,
  formatFacebookPost,
  formatInstagramPost,
  formatLinkedInPost,
  MissingImageError,
  specsLine,
  withUtm,
  type PostInput,
} from '@/lib/social/post-formatter';

const BASE: PostInput = {
  title: 'Modern 2BR loft near Zona Colonial',
  city: 'Santo Domingo',
  countryDisplay: 'Dominican Republic',
  priceCents: 22_500_000, // $225,000
  currency: 'USD',
  bedrooms: 2,
  bathrooms: 2,
  areaSqm: 95,
  url: 'https://advertisehomes.online/en/properties/modern-2br-loft-cQF9BN',
  imageUrls: ['https://imagedelivery.net/abc/img-id/og'],
  locale: 'en',
};

// ============================================================
// Helpers
// ============================================================

describe('post-formatter · specsLine', () => {
  it('returns null when every field is null or zero', () => {
    expect(specsLine({ bedrooms: null, bathrooms: null, areaSqm: null })).toBeNull();
    expect(specsLine({ bedrooms: 0, bathrooms: 0, areaSqm: 0 })).toBeNull();
  });

  it('omits zero/null fields and keeps the present ones', () => {
    expect(specsLine({ bedrooms: 2, bathrooms: null, areaSqm: null })).toBe('🛏 2');
    expect(specsLine({ bedrooms: null, bathrooms: null, areaSqm: 80 })).toBe('📐 80 m²');
    expect(specsLine({ bedrooms: 3, bathrooms: 1.5, areaSqm: 110 })).toBe('🛏 3 · 🛁 1.5 · 📐 110 m²');
  });

  it('rounds area to the nearest integer', () => {
    expect(specsLine({ bedrooms: null, bathrooms: null, areaSqm: 94.7 })).toBe('📐 95 m²');
  });
});

describe('post-formatter · cityHashtag', () => {
  it('lowercases + strips spaces', () => {
    expect(cityHashtag('Santo Domingo')).toBe('santodomingo');
    expect(cityHashtag('PUNTA CANA')).toBe('puntacana');
  });

  it('strips diacritics on decomposable letters', () => {
    expect(cityHashtag('Málaga')).toBe('malaga');
    expect(cityHashtag('Düsseldorf')).toBe('dusseldorf');
    expect(cityHashtag('São Paulo')).toBe('saopaulo');
  });

  it('strips punctuation', () => {
    expect(cityHashtag("Saint-Tropez")).toBe('sainttropez');
    expect(cityHashtag("St. John's")).toBe('stjohns');
  });

  it('handles partial-Latin Polish: Łódź → odz (ł stripped, ódź decomposed)', () => {
    // Polish "Łódź" — capital Ł (U+0141) is NOT NFD-decomposable so it
    // gets stripped entirely. ó (U+00F3) decomposes to o+◌́; ź (U+017A)
    // decomposes to z+◌́. Net output: "odz". Acceptable v1 compromise —
    // recognizable to a Polish reader and avoids transliteration tables.
    expect(cityHashtag('Łódź')).toBe('odz');
  });
});

describe('post-formatter · clamp', () => {
  it('returns the string unchanged when it fits', () => {
    expect(clamp('hello', 10)).toBe('hello');
    expect(clamp('exactly10c', 10)).toBe('exactly10c');
  });

  it('truncates and appends an ellipsis', () => {
    expect(clamp('this is a long string', 10)).toBe('this is a…');
    expect(clamp('abcdefghij', 5)).toBe('abcd…');
  });

  it('trims trailing whitespace before the ellipsis', () => {
    expect(clamp('abcd     ', 6)).toBe('abcd…');
  });
});

describe('post-formatter · withUtm', () => {
  it('appends UTM params with `?` when the URL has no query', () => {
    expect(withUtm('https://example.com/x', 'facebook')).toBe(
      'https://example.com/x?utm_source=facebook&utm_medium=social&utm_campaign=agent_share',
    );
  });

  it('appends UTM params with `&` when the URL already has a query', () => {
    expect(withUtm('https://example.com/x?ref=foo', 'instagram')).toBe(
      'https://example.com/x?ref=foo&utm_source=instagram&utm_medium=social&utm_campaign=agent_share',
    );
  });
});

// ============================================================
// Facebook
// ============================================================

describe('post-formatter · formatFacebookPost', () => {
  it('happy path — EN locale', () => {
    const out = formatFacebookPost(BASE);
    expect(out.message).toContain('Modern 2BR loft near Zona Colonial');
    expect(out.message).toContain('📍 Santo Domingo, Dominican Republic');
    expect(out.message).toContain('💰 $225,000');
    expect(out.message).toContain('🛏 2 · 🛁 2 · 📐 95 m²');
    expect(out.message).toContain('#realestate #aho #santodomingo');
    expect(out.link).toMatch(/utm_source=facebook/);
    expect(out.imageUrl).toBe(BASE.imageUrls?.[0]);
  });

  it('happy path — ES locale uses Spanish hashtags', () => {
    const out = formatFacebookPost({ ...BASE, locale: 'es' });
    expect(out.message).toContain('#inmuebles #aho #santodomingo');
    expect(out.message).not.toContain('#realestate');
  });

  it('omits imageUrl in output when not provided', () => {
    const out = formatFacebookPost({ ...BASE, imageUrls: undefined });
    expect(out.imageUrl).toBeUndefined();
  });

  it('handles missing optional fields (bedrooms/bathrooms/areaSqm all null)', () => {
    const out = formatFacebookPost({ ...BASE, bedrooms: null, bathrooms: null, areaSqm: null });
    expect(out.message).not.toContain('🛏');
    expect(out.message).not.toContain('🛁');
    expect(out.message).not.toContain('📐');
    expect(out.message).toContain('📍 Santo Domingo, Dominican Republic');
  });

  it('passes non-Latin characters through unchanged in the body', () => {
    const out = formatFacebookPost({
      ...BASE,
      title: 'Mieszkanie 95 m² blisko Wilanowska — Warszawa',
      city: 'Warszawa',
    });
    expect(out.message).toContain('Mieszkanie 95 m² blisko Wilanowska — Warszawa');
    expect(out.message).toContain('Warszawa, Dominican Republic');
    expect(out.message).toContain('#warszawa');
  });

  it('clamps an extremely long title so the message stays under the FB cap', () => {
    const longTitle = 'A'.repeat(5000);
    const out = formatFacebookPost({ ...BASE, title: longTitle });
    expect(out.message.length).toBeLessThanOrEqual(4000);
    expect(out.message.endsWith('…')).toBe(true);
  });

  it('falls back to EN templates for marketing locales (PL/PT/DE/FR/IT)', () => {
    // Listings in marketing locales render English content per the i18n
    // config; posts follow the same rule via narrowContentLocale().
    const out = formatFacebookPost({ ...BASE, locale: 'pl' });
    expect(out.message).toContain('#realestate');
  });

  it('omits the city hashtag suffix when city normalizes to empty', () => {
    const out = formatFacebookPost({ ...BASE, city: '!!!' });
    expect(out.message).toMatch(/#realestate #aho$/m);
  });
});

// ============================================================
// Instagram
// ============================================================

describe('post-formatter · formatInstagramPost', () => {
  it('happy path — caption + imageUrls returned', () => {
    const out = formatInstagramPost(BASE);
    expect(out.caption).toContain('✨ Modern 2BR loft near Zona Colonial');
    expect(out.caption).toContain('Link in bio:');
    expect(out.caption).toContain(BASE.url);
    expect(out.caption).toContain('#realestate #aho #propertyforsale #santodomingo #homesforsale');
    expect(out.imageUrls).toEqual(BASE.imageUrls);
  });

  it('preserves multi-image carousel input through to imageUrls', () => {
    const out = formatInstagramPost({
      ...BASE,
      imageUrls: ['url-1', 'url-2', 'url-3'],
    });
    expect(out.imageUrls).toEqual(['url-1', 'url-2', 'url-3']);
  });

  it('clamps imageUrls past IG_CAROUSEL_MAX (10) to the first 10', () => {
    const urls = Array.from({ length: 15 }, (_, i) => `url-${i}`);
    const out = formatInstagramPost({ ...BASE, imageUrls: urls });
    expect(out.imageUrls).toHaveLength(10);
    expect(out.imageUrls[0]).toBe('url-0');
    expect(out.imageUrls[9]).toBe('url-9');
  });

  it('filters out empty-string URLs before evaluating MissingImageError', () => {
    expect(() =>
      formatInstagramPost({ ...BASE, imageUrls: ['', ''] }),
    ).toThrow(MissingImageError);
    const out = formatInstagramPost({ ...BASE, imageUrls: ['', 'real-url'] });
    expect(out.imageUrls).toEqual(['real-url']);
  });

  it('ES locale uses "Enlace en bio" + Spanish hashtags', () => {
    const out = formatInstagramPost({ ...BASE, locale: 'es' });
    expect(out.caption).toContain('Enlace en bio:');
    expect(out.caption).toContain('#inmuebles #aho #bienesraices #santodomingo #propiedadesenventa');
  });

  it('throws MissingImageError when imageUrls is absent or empty', () => {
    expect(() => formatInstagramPost({ ...BASE, imageUrls: undefined })).toThrow(MissingImageError);
    expect(() => formatInstagramPost({ ...BASE, imageUrls: [] })).toThrow(MissingImageError);
  });

  it('clamps the caption to the IG cap', () => {
    const out = formatInstagramPost({ ...BASE, title: 'X'.repeat(3000) });
    expect(out.caption.length).toBeLessThanOrEqual(2000);
    expect(out.caption.endsWith('…')).toBe(true);
  });

  it('handles all-null specs without producing dangling separators', () => {
    const out = formatInstagramPost({ ...BASE, bedrooms: null, bathrooms: null, areaSqm: null });
    expect(out.caption).not.toContain('🛏');
    expect(out.caption).not.toContain('· ·');
  });
});

// ============================================================
// LinkedIn
// ============================================================

describe('post-formatter · formatLinkedInPost', () => {
  it('happy path — EN', () => {
    const out = formatLinkedInPost(BASE);
    expect(out.commentary).toContain('New on the market: Modern 2BR loft near Zona Colonial');
    expect(out.commentary).toContain('Location: Santo Domingo, Dominican Republic');
    expect(out.commentary).toContain('Price: $225,000');
    expect(out.commentary).toContain('Details: 🛏 2 · 🛁 2 · 📐 95 m²');
    expect(out.commentary).toContain('#realestate #property #investment');
    expect(out.contentUrl).toMatch(/utm_source=linkedin/);
    expect(out.contentTitle).toBe(BASE.title);
    expect(out.contentDescription).toContain('Santo Domingo');
    expect(out.contentThumbnailUrl).toBe(BASE.imageUrls?.[0]);
  });

  it('happy path — ES', () => {
    const out = formatLinkedInPost({ ...BASE, locale: 'es' });
    expect(out.commentary).toContain('Nuevo en el mercado:');
    expect(out.commentary).toContain('Ubicación: Santo Domingo, Dominican Republic');
    expect(out.commentary).toContain('Precio: ');
    expect(out.commentary).toContain('#bienesraices #inmuebles #inversion');
  });

  it('clamps contentTitle to 200 chars', () => {
    const out = formatLinkedInPost({ ...BASE, title: 'A'.repeat(500) });
    expect(out.contentTitle.length).toBeLessThanOrEqual(200);
    expect(out.contentTitle.endsWith('…')).toBe(true);
  });

  it('clamps contentDescription to 256 chars', () => {
    const out = formatLinkedInPost({
      ...BASE,
      city: 'X'.repeat(300),
      countryDisplay: 'Y'.repeat(300),
    });
    expect(out.contentDescription.length).toBeLessThanOrEqual(256);
  });

  it('clamps commentary to the LinkedIn cap', () => {
    const out = formatLinkedInPost({ ...BASE, title: 'Z'.repeat(5000) });
    expect(out.commentary.length).toBeLessThanOrEqual(2800);
    expect(out.commentary.endsWith('…')).toBe(true);
  });

  it('omits contentThumbnailUrl when imageUrl absent', () => {
    const out = formatLinkedInPost({ ...BASE, imageUrls: undefined });
    expect(out.contentThumbnailUrl).toBeUndefined();
  });

  it('handles missing optional specs', () => {
    const out = formatLinkedInPost({ ...BASE, bedrooms: null, bathrooms: null, areaSqm: null });
    expect(out.commentary).not.toContain('Details:');
    expect(out.contentDescription).not.toContain('·  ·'); // no dangling separator
  });
});
