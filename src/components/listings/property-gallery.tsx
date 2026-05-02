import { buildImageUrl } from '@/lib/listings/image-url';
import {
  buildPhotoAlt,
  buildPhotoCaption,
  type TransactionType,
} from '@/lib/listings/photo-seo';
import type { Locale } from '@/i18n/config';

interface ImageItem {
  cfImageId: string | null;
  r2Key: string | null;
  altTextEn: string | null;
  altTextEs: string | null;
  isPrimary: boolean;
  position: number;
}

interface Props {
  images: ImageItem[];
  locale: Locale;
  /** Listing title in the active locale (page already resolves with EN→ES fallback). */
  title: string;
  /** Used by the SEO alt-text builder + figcaption. */
  transactionType: TransactionType;
  propertyType: string;
  city: string;
  /** Localized country name from `getCountryName(countryCode, locale)`. */
  countryDisplay: string;
}

/**
 * Property detail page gallery. Two contracts:
 *
 *   1. **No-crop policy** (PO 2026-05-02). Primary image preserves its
 *      original aspect ratio — `object-contain` + a subtle muted bg
 *      fills any letterbox bands when the image ratio doesn't match the
 *      container. Mobile renders the primary at natural aspect via
 *      `aspect-auto` (image dictates the height), so a tall portrait
 *      shows in full and a wide panorama shows in full — no crop in
 *      either direction. Desktop uses `object-contain` inside the grid
 *      cell so the primary stays balanced with the secondary thumbs.
 *
 *   2. **SEO-rich alt + caption.** Every <img> gets an alt that
 *      combines the listing title + property-type label + transaction
 *      phrase ("for sale" / "en venta" / etc.) + city + country. The
 *      primary photo also has a visible <figcaption> ("leyenda") so the
 *      same description appears to humans, not just to screen readers
 *      and Google Image Search. See `lib/listings/photo-seo.ts`.
 *
 * Mobile (< md): primary photo is FULL-BLEED — breaks out of the page
 *   container with `-mx-4` so it spans viewport edge-to-edge. Square
 *   corners on mobile, rounded on md+. Below the primary: figcaption +
 *   horizontal carousel of secondary thumbs (also `object-contain`,
 *   fixed-height container so the row stays consistent).
 * Desktop (md+): 4-column 2-row grid; primary spans cols 1-2 rows 1-2;
 *   four secondaries fill cols 3-4 in 2x2.
 *
 * Renders a token-styled empty placeholder if there are no confirmed
 * images yet — no fake stock photos per CLAUDE.md hard rule #8.
 */
export function PropertyGallery({
  images,
  locale,
  title,
  transactionType,
  propertyType,
  city,
  countryDisplay,
}: Props) {
  // Renderable images: have either a cf_image_id (CF Images path) or an
  // r2_key (R2 public URL fallback). Filter out rows missing both.
  const sorted = [...images]
    .filter((img) => img.cfImageId || img.r2Key)
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (b.isPrimary && !a.isPrimary) return 1;
      return a.position - b.position;
    });

  if (sorted.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[16/9] w-full items-center justify-center border border-dashed border-border-strong/40 bg-surface shadow-whisper md:rounded-card dark:bg-surface-deep"
        style={{
          backgroundImage:
            'linear-gradient(135deg, rgb(97 104 117 / 0.04), rgb(97 104 117 / 0.01))',
        }}
      >
        <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {locale === 'es' ? 'Sin fotos aún' : 'No photos yet'}
        </span>
      </div>
    );
  }

  const primary = sorted[0]!;
  const secondaries = sorted.slice(1, 5);
  const total = sorted.length;

  // SEO-friendly alt text for every photo. Caller-supplied alt_text_en/es
  // (the agent's per-image override, almost never set today) takes
  // precedence over the auto-built version; this lets a single hand-
  // crafted caption beat the template when it exists.
  const altOf = (img: ImageItem, position: number): string => {
    const explicit =
      (locale === 'es' ? img.altTextEs : img.altTextEn) ??
      img.altTextEn ??
      img.altTextEs;
    if (explicit && explicit.trim().length > 0) return explicit;
    return buildPhotoAlt({
      title,
      transactionType,
      propertyType,
      city,
      countryDisplay,
      position,
      total,
      locale,
    });
  };

  // Visible caption on the primary. Same SEO content but without the
  // "Photo 2 of 8" suffix (only one shown; suffix would be visual noise).
  const primaryCaption = buildPhotoCaption({
    title,
    transactionType,
    propertyType,
    city,
    countryDisplay,
    locale,
  });

  const primaryUrl = buildImageUrl({
    cfImageId: primary.cfImageId,
    r2Key: primary.r2Key,
    variant: 'public',
  });
  if (!primaryUrl) {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[16/9] w-full items-center justify-center border border-dashed border-border-strong/40 bg-surface shadow-whisper md:rounded-card dark:bg-surface-deep"
      >
        <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {locale === 'es' ? 'Sin fotos aún' : 'No photos yet'}
        </span>
      </div>
    );
  }

  return (
    // Break out of the parent container's px-4 on mobile so the gallery
    // is true edge-to-edge. md+ falls back to inside-container layout.
    <figure className="-mx-4 md:mx-0">
      {/* ── Primary photo ──
          Mobile: full-bleed, natural aspect (h-auto). Image height is
          driven by the image's intrinsic dimensions — a 16:9 panorama is
          short and wide, a 3:4 portrait is tall and narrow. No crop, no
          letterbox; just the image at its true ratio.
          Desktop (md+): same image, capped at max-h-[600px] so a tall
          portrait doesn't dominate the viewport. The container uses
          flex centering so a too-narrow portrait sits centered with bg
          letterbox bands; a wide landscape fills the width up to its
          natural height. Either way: object-contain = no crop. */}
      <div className="flex w-full justify-center bg-surface-muted dark:bg-surface-dark md:rounded-card md:overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={primaryUrl}
          alt={altOf(primary, 1)}
          className="block h-auto max-h-[80vh] w-auto max-w-full md:max-h-[600px]"
          loading="eager"
          decoding="async"
        />
      </div>

      <figcaption className="px-4 py-2 text-xs leading-relaxed text-helper md:mt-3 md:px-0 md:text-sm">
        {primaryCaption}
      </figcaption>

      {/* ── Secondary thumbs ──
          Single horizontal row on every breakpoint. Mobile snap-scrolls;
          desktop fits 4 evenly. Each thumb cell is a fixed-height box
          (h-32 mobile, h-40 desktop) — gives the row a consistent visual
          rhythm — but the image inside uses object-contain so the WHOLE
          photo is visible (with subtle bg letterbox if its natural ratio
          differs from the cell). */}
      {secondaries.length > 0 && (
        <div className="mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 md:mt-3 md:grid md:grid-cols-4 md:overflow-x-visible md:px-0 md:pb-0">
          {secondaries.map((img, idx) => {
            const url = buildImageUrl({
              cfImageId: img.cfImageId,
              r2Key: img.r2Key,
              variant: 'card',
            });
            if (!url) return null;
            return (
              <div
                key={img.cfImageId ?? img.r2Key}
                className="flex h-32 shrink-0 basis-[60%] snap-start items-center justify-center overflow-hidden rounded-card bg-surface-muted sm:basis-[45%] md:h-40 md:basis-auto dark:bg-surface-dark"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={altOf(img, idx + 2)}
                  className="block max-h-full max-w-full"
                  loading="lazy"
                  decoding="async"
                />
              </div>
            );
          })}
        </div>
      )}
    </figure>
  );
}
