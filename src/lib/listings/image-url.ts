/**
 * Image URL builder. Two paths in priority order:
 *
 *   1. Cloudflare Images (when `NEXT_PUBLIC_CF_IMAGES_HASH` is set + the
 *      DB row has a `cf_image_id`). Best quality + auto-variants. Format:
 *      `https://imagedelivery.net/{hash}/{cfImageId}/{variant}`.
 *
 *   2. R2 public dev URL (when `NEXT_PUBLIC_R2_PUBLIC_URL` is set + the
 *      DB row has an `r2_key`). Direct read of the original. Used today
 *      while Cloudflare Images is not yet configured. Format:
 *      `{r2PublicUrl}/{r2Key}`.
 *
 * Returns null if neither configured-and-matched. Caller renders a
 * placeholder when null.
 *
 * Pure function — no env access via `serverEnv()` because it runs in
 * Client Components too. Reads `process.env.NEXT_PUBLIC_*` directly,
 * which Next.js inlines at build time.
 */

interface ImageUrlArgs {
  cfImageId: string | null;
  r2Key: string | null;
  /** Cloudflare Images variant name (card | public | thumbnail | …). */
  variant: 'card' | 'public' | 'thumbnail';
}

export function buildImageUrl(args: ImageUrlArgs): string | null {
  const cfHash = process.env.NEXT_PUBLIC_CF_IMAGES_HASH;
  if (cfHash && args.cfImageId) {
    return `https://imagedelivery.net/${cfHash}/${args.cfImageId}/${args.variant}`;
  }
  const r2Public = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  if (r2Public && args.r2Key) {
    return `${r2Public.replace(/\/$/, '')}/${args.r2Key}`;
  }
  return null;
}
