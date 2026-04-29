import { describe, expect, it } from 'vitest';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_IMAGES_PER_PROPERTY,
  UploadRequestSchema,
  ConfirmRequestSchema,
  buildR2Key,
  checkImageCap,
} from '../../src/lib/listings/upload';

describe('UploadRequestSchema', () => {
  const valid = {
    filename: 'photo.jpg',
    contentType: 'image/jpeg' as const,
  };

  it('accepts a minimal valid payload', () => {
    expect(UploadRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts all whitelisted content types', () => {
    for (const ct of ALLOWED_CONTENT_TYPES) {
      const result = UploadRequestSchema.safeParse({ ...valid, contentType: ct });
      expect(result.success).toBe(true);
    }
  });

  it('rejects content types outside the allowlist', () => {
    for (const bad of ['image/svg+xml', 'image/gif', 'image/bmp', 'application/octet-stream']) {
      const result = UploadRequestSchema.safeParse({ ...valid, contentType: bad });
      expect(result.success).toBe(false);
    }
  });

  it('rejects empty or oversize filenames', () => {
    expect(UploadRequestSchema.safeParse({ ...valid, filename: '' }).success).toBe(false);
    expect(
      UploadRequestSchema.safeParse({ ...valid, filename: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('rejects files that exceed the byte cap', () => {
    expect(
      UploadRequestSchema.safeParse({ ...valid, byteSize: MAX_FILE_SIZE_BYTES + 1 }).success,
    ).toBe(false);
  });

  it('accepts files at exactly the byte cap', () => {
    const result = UploadRequestSchema.safeParse({ ...valid, byteSize: MAX_FILE_SIZE_BYTES });
    expect(result.success).toBe(true);
  });

  it('accepts optional metadata', () => {
    const result = UploadRequestSchema.safeParse({
      ...valid,
      altTextEn: 'Photo of the front',
      altTextEs: 'Foto del frente',
      position: 0,
      isPrimary: true,
    });
    expect(result.success).toBe(true);
  });
});

describe('ConfirmRequestSchema', () => {
  it('accepts width + height', () => {
    expect(
      ConfirmRequestSchema.safeParse({ width: 1280, height: 853 }).success,
    ).toBe(true);
  });

  it('accepts an optional cf_image_id', () => {
    expect(
      ConfirmRequestSchema.safeParse({
        width: 1280,
        height: 853,
        cfImageId: 'a1b2c3',
      }).success,
    ).toBe(true);
  });

  it('rejects non-positive dimensions', () => {
    expect(ConfirmRequestSchema.safeParse({ width: 0, height: 0 }).success).toBe(false);
    expect(ConfirmRequestSchema.safeParse({ width: -10, height: 100 }).success).toBe(
      false,
    );
  });

  it('rejects suspicious dimensions (> 20000 px)', () => {
    expect(
      ConfirmRequestSchema.safeParse({ width: 30000, height: 100 }).success,
    ).toBe(false);
  });
});

describe('buildR2Key', () => {
  it('produces stable keys with the right extension', () => {
    expect(buildR2Key('prop-uuid', 'img-uuid', 'image/jpeg')).toBe(
      'properties/prop-uuid/img-uuid.jpg',
    );
    expect(buildR2Key('prop-uuid', 'img-uuid', 'image/png')).toBe(
      'properties/prop-uuid/img-uuid.png',
    );
    expect(buildR2Key('prop-uuid', 'img-uuid', 'image/webp')).toBe(
      'properties/prop-uuid/img-uuid.webp',
    );
    expect(buildR2Key('prop-uuid', 'img-uuid', 'image/heic')).toBe(
      'properties/prop-uuid/img-uuid.heic',
    );
    expect(buildR2Key('prop-uuid', 'img-uuid', 'image/heif')).toBe(
      'properties/prop-uuid/img-uuid.heif',
    );
  });
});

describe('checkImageCap', () => {
  it('passes when under the cap', () => {
    const result = checkImageCap(0);
    expect(result.ok).toBe(true);
    expect(result.limit).toBe(MAX_IMAGES_PER_PROPERTY);
    expect(result.current).toBe(0);
  });

  it('passes when at limit minus one', () => {
    expect(checkImageCap(MAX_IMAGES_PER_PROPERTY - 1).ok).toBe(true);
  });

  it('fails when at the cap', () => {
    expect(checkImageCap(MAX_IMAGES_PER_PROPERTY).ok).toBe(false);
  });

  it('fails when above the cap', () => {
    expect(checkImageCap(MAX_IMAGES_PER_PROPERTY + 5).ok).toBe(false);
  });
});
