import 'server-only';
import { z } from 'zod';

/**
 * Validation + helpers for the property-image upload flow.
 *
 * Pure functions — no DB or HTTP — so they unit-test cleanly without mocks.
 */

export const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;
export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

export const MAX_IMAGES_PER_PROPERTY = 30; // per HANDOFF.md §8.4
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB per HANDOFF.md §8.4

export const UploadRequestSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(ALLOWED_CONTENT_TYPES),
  // Optional metadata captured at sign-time so the row is fully
  // populated when the client confirms.
  altTextEn: z.string().max(500).optional(),
  altTextEs: z.string().max(500).optional(),
  position: z.number().int().nonnegative().optional(),
  isPrimary: z.boolean().optional(),
  /** Client-reported size; rejected at sign-time if it exceeds the cap. */
  byteSize: z.number().int().positive().max(MAX_FILE_SIZE_BYTES).optional(),
});
export type UploadRequest = z.infer<typeof UploadRequestSchema>;

export const ConfirmRequestSchema = z.object({
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
  /** Optional — set when Cloudflare Images returns a variant ID. */
  cfImageId: z.string().min(1).max(200).optional(),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

const EXT_BY_TYPE: Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

/**
 * Build the R2 object key for a property image. The shape is stable across
 * environments and per HANDOFF.md §3.4: `properties/{propId}/{uuid}.{ext}`.
 */
export function buildR2Key(propertyId: string, imageId: string, contentType: AllowedContentType): string {
  return `properties/${propertyId}/${imageId}.${EXT_BY_TYPE[contentType]}`;
}

interface CapResult {
  ok: boolean;
  current: number;
  limit: number;
}

/** Returns whether a property is still under the per-listing image cap. */
export function checkImageCap(currentCount: number): CapResult {
  return {
    ok: currentCount < MAX_IMAGES_PER_PROPERTY,
    current: currentCount,
    limit: MAX_IMAGES_PER_PROPERTY,
  };
}
