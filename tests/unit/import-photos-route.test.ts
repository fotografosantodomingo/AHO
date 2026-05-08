import { describe, expect, it } from 'vitest';
import {
  BodySchema,
  EXT_BY_TYPE,
  MAX_IMAGE_BYTES,
  classifyImageContentType,
  computeImportSlots,
  isRetriableFetchError,
  normalizeContentType,
} from '@/app/api/properties/[id]/import-photos/route';
import { MAX_IMAGES_PER_PROPERTY } from '@/lib/listings/upload';

describe('import-photos BodySchema', () => {
  it('accepts a minimal valid payload', () => {
    expect(
      BodySchema.safeParse({ urls: ['https://example.com/a.jpg'] }).success,
    ).toBe(true);
  });

  it('accepts up to 15 URLs', () => {
    const urls = Array.from({ length: 15 }, (_, i) => `https://example.com/${i}.jpg`);
    expect(BodySchema.safeParse({ urls }).success).toBe(true);
  });

  it('rejects a non-array urls field', () => {
    expect(BodySchema.safeParse({ urls: 'https://x/y.jpg' }).success).toBe(false);
    expect(BodySchema.safeParse({ urls: { 0: 'https://x/y.jpg' } }).success).toBe(false);
    expect(BodySchema.safeParse({ urls: null }).success).toBe(false);
  });

  it('rejects an empty array', () => {
    expect(BodySchema.safeParse({ urls: [] }).success).toBe(false);
  });

  it('rejects more than 15 URLs', () => {
    const urls = Array.from({ length: 16 }, (_, i) => `https://example.com/${i}.jpg`);
    expect(BodySchema.safeParse({ urls }).success).toBe(false);
  });

  it('rejects non-URL strings inside the array', () => {
    expect(BodySchema.safeParse({ urls: ['not a url'] }).success).toBe(false);
    expect(BodySchema.safeParse({ urls: ['/relative/path.jpg'] }).success).toBe(false);
    expect(BodySchema.safeParse({ urls: [''] }).success).toBe(false);
  });

  it('rejects non-string array entries', () => {
    expect(BodySchema.safeParse({ urls: [123] }).success).toBe(false);
    expect(BodySchema.safeParse({ urls: [null] }).success).toBe(false);
  });
});

describe('normalizeContentType', () => {
  it('lowercases and trims', () => {
    expect(normalizeContentType('  IMAGE/JPEG  ')).toBe('image/jpeg');
  });

  it('strips charset / parameter suffix', () => {
    expect(normalizeContentType('image/jpeg;charset=binary')).toBe('image/jpeg');
    expect(normalizeContentType('image/png; charset=utf-8')).toBe('image/png');
    expect(normalizeContentType('image/webp;boundary=---x')).toBe('image/webp');
  });

  it('treats null/undefined/empty as empty string', () => {
    expect(normalizeContentType(null)).toBe('');
    expect(normalizeContentType(undefined)).toBe('');
    expect(normalizeContentType('')).toBe('');
  });
});

describe('classifyImageContentType', () => {
  it('accepts every whitelisted image type', () => {
    for (const ct of Object.keys(EXT_BY_TYPE)) {
      const result = classifyImageContentType(ct);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.type).toBe(ct);
    }
  });

  it('accepts whitelisted types when content-type carries a parameter suffix', () => {
    const result = classifyImageContentType('image/jpeg;charset=binary');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.type).toBe('image/jpeg');
  });

  it('rejects non-image content-types as not_an_image', () => {
    for (const bad of ['text/html', 'application/octet-stream', 'application/json']) {
      const result = classifyImageContentType(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorCode).toBe('not_an_image');
    }
  });

  it('rejects image/* content-types outside the allowlist as unsupported_type', () => {
    for (const bad of ['image/gif', 'image/svg+xml', 'image/bmp', 'image/avif']) {
      const result = classifyImageContentType(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorCode).toBe('unsupported_type');
    }
  });

  it('rejects missing/empty content-type as not_an_image', () => {
    for (const empty of [null, undefined, '']) {
      const result = classifyImageContentType(empty);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errorCode).toBe('not_an_image');
    }
  });
});

describe('computeImportSlots', () => {
  const cap = MAX_IMAGES_PER_PROPERTY;

  it('processes the entire url list when there is plenty of headroom', () => {
    const slots = computeImportSlots({ existingCount: 0, urlsLength: 5, cap });
    expect(slots.remaining).toBe(cap);
    expect(slots.toProcess).toBe(5);
    expect(slots.skipped).toBe(0);
  });

  it('caps the processed count at (cap - existing)', () => {
    const slots = computeImportSlots({
      existingCount: cap - 3,
      urlsLength: 10,
      cap,
    });
    expect(slots.remaining).toBe(3);
    expect(slots.toProcess).toBe(3);
    expect(slots.skipped).toBe(7);
  });

  it('processes nothing when already at the cap', () => {
    const slots = computeImportSlots({ existingCount: cap, urlsLength: 5, cap });
    expect(slots.remaining).toBe(0);
    expect(slots.toProcess).toBe(0);
    expect(slots.skipped).toBe(5);
  });

  it('clamps remaining to 0 when existing exceeds the cap', () => {
    const slots = computeImportSlots({ existingCount: cap + 10, urlsLength: 5, cap });
    expect(slots.remaining).toBe(0);
    expect(slots.toProcess).toBe(0);
    expect(slots.skipped).toBe(5);
  });

  it('matches "first (cap - N) URLs are processed" wording from the spec', () => {
    // With N existing images and a URL list bigger than (cap - N), only
    // the first (cap - N) URLs are processed. We pass urlsLength = cap
    // so the cap is the binding constraint.
    const N = 7;
    const slots = computeImportSlots({ existingCount: N, urlsLength: cap, cap });
    expect(slots.toProcess).toBe(cap - N);
    expect(slots.skipped).toBe(N);
  });
});

describe('MAX_IMAGE_BYTES', () => {
  it('is the documented 15 MB cap', () => {
    expect(MAX_IMAGE_BYTES).toBe(15 * 1024 * 1024);
  });
});

describe('isRetriableFetchError', () => {
  it('retries network-layer failures', () => {
    expect(isRetriableFetchError('timeout')).toBe(true);
    expect(isRetriableFetchError('fetch_failed')).toBe(true);
  });

  it('retries HTTP 408 and 429', () => {
    expect(isRetriableFetchError('fetch_408')).toBe(true);
    expect(isRetriableFetchError('fetch_429')).toBe(true);
  });

  it('retries any HTTP 5xx', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      expect(isRetriableFetchError(`fetch_${status}`)).toBe(true);
    }
  });

  it('does NOT retry HTTP 4xx other than 408/429', () => {
    for (const status of [400, 401, 403, 404, 410, 451]) {
      expect(isRetriableFetchError(`fetch_${status}`)).toBe(false);
    }
  });

  it('does NOT retry deterministic content errors', () => {
    expect(isRetriableFetchError('not_an_image')).toBe(false);
    expect(isRetriableFetchError('unsupported_type')).toBe(false);
    expect(isRetriableFetchError('too_large')).toBe(false);
    expect(isRetriableFetchError('empty')).toBe(false);
  });

  it('does NOT retry unknown / non-fetch error codes', () => {
    expect(isRetriableFetchError('r2_put_failed')).toBe(false);
    expect(isRetriableFetchError('insert_failed')).toBe(false);
    expect(isRetriableFetchError('forbidden')).toBe(false);
    expect(isRetriableFetchError('fetch_NaN')).toBe(false);
  });
});
