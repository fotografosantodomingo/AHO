import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  buildImageEntriesForListing,
  MAX_IMAGES_PER_LISTING,
  type SitemapImageRow,
} from '@/lib/seo/image-sitemap';

/**
 * `buildImageUrl` (and therefore `buildImageEntriesForListing`) reads
 * `process.env.NEXT_PUBLIC_CF_IMAGES_HASH` and `_R2_PUBLIC_URL` directly
 * — Next.js inlines these at build time in production but here we set
 * them explicitly so the unit tests can exercise both paths.
 */

const ORIG = {
  cfHash: process.env.NEXT_PUBLIC_CF_IMAGES_HASH,
  r2Public: process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
};

beforeAll(() => {
  process.env.NEXT_PUBLIC_CF_IMAGES_HASH = 'testhash123';
  delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
});

afterAll(() => {
  if (ORIG.cfHash === undefined) delete process.env.NEXT_PUBLIC_CF_IMAGES_HASH;
  else process.env.NEXT_PUBLIC_CF_IMAGES_HASH = ORIG.cfHash;
  if (ORIG.r2Public === undefined) delete process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  else process.env.NEXT_PUBLIC_R2_PUBLIC_URL = ORIG.r2Public;
});

function img(p: number, overrides: Partial<SitemapImageRow> = {}): SitemapImageRow {
  return {
    cf_image_id: `cf-id-${p}`,
    r2_key: null,
    alt_text_en: `EN alt ${p}`,
    alt_text_es: `ES alt ${p}`,
    position: p,
    ...overrides,
  };
}

describe('buildImageEntriesForListing', () => {
  it('emits one entry per image up to MAX_IMAGES_PER_LISTING', () => {
    const images = Array.from({ length: 12 }, (_, i) => img(i));
    const entries = buildImageEntriesForListing({
      images,
      locale: 'en',
      listingTitle: 'Casa Bonita',
    });
    expect(entries).toHaveLength(MAX_IMAGES_PER_LISTING);
    expect(MAX_IMAGES_PER_LISTING).toBe(5);
  });

  it('uses the Cloudflare Images public-variant URL when cf_image_id present', () => {
    const entries = buildImageEntriesForListing({
      images: [img(0)],
      locale: 'en',
      listingTitle: 'X',
    });
    expect(entries[0]?.loc).toBe(
      'https://imagedelivery.net/testhash123/cf-id-0/public',
    );
  });

  it('picks locale-aware caption (ES alt for /es URL, EN alt for /en URL)', () => {
    const entries = buildImageEntriesForListing({
      images: [img(0)],
      locale: 'es',
      listingTitle: 'X',
    });
    expect(entries[0]?.caption).toBe('ES alt 0');

    const enEntries = buildImageEntriesForListing({
      images: [img(0)],
      locale: 'en',
      listingTitle: 'X',
    });
    expect(enEntries[0]?.caption).toBe('EN alt 0');
  });

  it('falls back to the other locale alt when target locale alt is missing', () => {
    const entries = buildImageEntriesForListing({
      images: [img(0, { alt_text_es: null })],
      locale: 'es',
      listingTitle: 'X',
    });
    expect(entries[0]?.caption).toBe('EN alt 0');
  });

  it('returns a null caption when both alts are missing (still emits the entry)', () => {
    const entries = buildImageEntriesForListing({
      images: [img(0, { alt_text_en: null, alt_text_es: null })],
      locale: 'en',
      listingTitle: 'Casa Bonita',
    });
    expect(entries[0]?.caption).toBeNull();
    // Title still surfaces — gives Google Image Search some context
    // even on legacy uploads.
    expect(entries[0]?.title).toBe('Casa Bonita');
  });

  it('drops images that produce no URL (no cf_image_id and no r2_key)', () => {
    const entries = buildImageEntriesForListing({
      images: [
        img(0, { cf_image_id: null, r2_key: null }),
        img(1),
      ],
      locale: 'en',
      listingTitle: 'X',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.loc).toContain('cf-id-1');
  });

  it('preserves position order even when input is shuffled', () => {
    const entries = buildImageEntriesForListing({
      images: [img(2), img(0), img(1)],
      locale: 'en',
      listingTitle: 'X',
    });
    expect(entries.map((e) => e.loc)).toEqual([
      'https://imagedelivery.net/testhash123/cf-id-0/public',
      'https://imagedelivery.net/testhash123/cf-id-1/public',
      'https://imagedelivery.net/testhash123/cf-id-2/public',
    ]);
  });

  it('attaches the listing title to every entry', () => {
    const entries = buildImageEntriesForListing({
      images: [img(0), img(1)],
      locale: 'en',
      listingTitle: '3BR Penthouse — Punta Cana',
    });
    for (const e of entries) {
      expect(e.title).toBe('3BR Penthouse — Punta Cana');
    }
  });
});
