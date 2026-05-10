import { buildImageUrl } from '@/lib/listings/image-url';

/**
 * Image-sitemap composition helpers — pure, fully unit-testable
 * (no Supabase, no env access beyond what `buildImageUrl` reads
 * synchronously from `process.env`).
 */

/**
 * Cap on `<image:image>` children per `<url>` entry. Google's image
 * sitemap protocol allows up to 1,000 per URL, but with hundreds of
 * thousands of listings the file size balloons. Five photos per listing
 * is enough to cover the hero + room exteriors; the gallery itself is
 * crawlable from the property page once Googlebot lands there. Keeping
 * the cap low protects total file size against the 50 MB / 50,000 URL
 * sitemap protocol limits.
 */
export const MAX_IMAGES_PER_LISTING = 5;

/**
 * Cloudflare Images variant to use for sitemap submission. `public` is
 * the standard "raw" variant configured in CF Images dashboard
 * (uncropped, full quality). Per Google: avoid thumbnail variants in
 * the image sitemap — submit the largest you have, Google selects the
 * crop. Note: in the all-R2 fallback path (NEXT_PUBLIC_R2_PUBLIC_URL
 * present, NEXT_PUBLIC_CF_IMAGES_HASH absent), `buildImageUrl` ignores
 * variant and returns the raw R2 object URL — same outcome.
 */
const SITEMAP_VARIANT = 'public' as const;

export interface SitemapImageRow {
  cf_image_id: string | null;
  r2_key: string | null;
  alt_text_en: string | null;
  alt_text_es: string | null;
  position: number;
}

export interface SitemapImageEntry {
  loc: string;
  caption: string | null;
  title: string | null;
}

/**
 * For one listing in one locale, project the per-image rows into the
 * `<image:image>`-shape data. Caps at `MAX_IMAGES_PER_LISTING`, drops
 * rows where neither cf_image_id nor r2_key produces a URL, and picks
 * locale-aware alt text (with cross-locale fallback when only one side
 * has alt text written — pragmatic compromise: Google's image-search
 * caption beats no caption).
 *
 * `title` falls back to the listing title for that locale so that every
 * `<image:image>` carries some context even on legacy uploads that
 * predate the alt-text capture flow.
 */
export function buildImageEntriesForListing(args: {
  images: ReadonlyArray<SitemapImageRow>;
  locale: 'en' | 'es';
  listingTitle: string | null;
}): SitemapImageEntry[] {
  const out: SitemapImageEntry[] = [];
  // Position-sorted by the SQL query, but defensive in case callers
  // pass an unsorted slice.
  const sorted = [...args.images].sort((a, b) => a.position - b.position);
  for (const img of sorted) {
    if (out.length >= MAX_IMAGES_PER_LISTING) break;
    const loc = buildImageUrl({
      cfImageId: img.cf_image_id,
      r2Key: img.r2_key,
      variant: SITEMAP_VARIANT,
    });
    if (!loc) continue;
    const localizedAlt =
      args.locale === 'es' ? img.alt_text_es : img.alt_text_en;
    const fallbackAlt =
      args.locale === 'es' ? img.alt_text_en : img.alt_text_es;
    const caption = localizedAlt ?? fallbackAlt ?? null;
    out.push({
      loc,
      caption,
      title: args.listingTitle,
    });
  }
  return out;
}
