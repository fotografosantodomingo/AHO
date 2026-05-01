import { buildImageUrl } from '@/lib/listings/image-url';
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
  fallbackAlt: string;
}

/**
 * Property detail page hero gallery.
 *
 * Mobile (< md): primary photo is FULL-BLEED — breaks out of the page
 *   container with `-mx-4` so it spans viewport edge-to-edge. Square
 *   corners on mobile (no rounded-card; would clash with the viewport
 *   edge), rounded on md+. Aspect 4:3. Secondary thumbs are a horizontal
 *   carousel below, also breaking out of the container.
 * Desktop (md+): 4-column grid with `gap-2` + `rounded-card` corners;
 *   primary spans cols 1-2 rows 1-2, up to four secondary thumbs fill
 *   cols 3-4 in a 2x2.
 *
 * Why full-bleed on mobile: a property's photos are the single most
 * persuasive piece of content on the page; constraining them inside the
 * 16px page padding wastes ~5% of horizontal real estate on small screens
 * and crops the image visibly. PO directive 2026-05-01.
 *
 * Renders a token-styled empty placeholder if there are no confirmed
 * images yet (early days; no Cloudflare Images uploaded). No fake stock
 * photos per CLAUDE.md hard rule #8 — the empty state reads as honest
 * emptiness.
 */
export function PropertyGallery({ images, locale, fallbackAlt }: Props) {
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

  const altOf = (img: ImageItem) =>
    (locale === 'es' ? img.altTextEs : img.altTextEn) ??
    img.altTextEn ??
    img.altTextEs ??
    fallbackAlt;

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
    // is true edge-to-edge. md+ falls back to inside-container layout
    // (page already has its own max-width + padding rules at md+).
    <div className="-mx-4 md:mx-0">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4 md:grid-rows-2">
        {/* Primary photo */}
        <div className="overflow-hidden md:col-span-2 md:row-span-2 md:rounded-card">
          <div className="aspect-[4/3] w-full md:h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={primaryUrl}
              alt={altOf(primary)}
              className="h-full w-full object-cover"
              loading="eager"
              decoding="async"
            />
          </div>
        </div>

        {/* Secondary thumbs — horizontal carousel on mobile (snap-on-x for
            iOS-feel scrolling), grid contents on md+. */}
        {secondaries.length > 0 && (
          <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 md:contents md:overflow-x-visible md:px-0">
            {secondaries.map((img) => {
              const url = buildImageUrl({
                cfImageId: img.cfImageId,
                r2Key: img.r2Key,
                variant: 'card',
              });
              if (!url) return null;
              return (
                <div
                  key={img.cfImageId ?? img.r2Key}
                  className="aspect-[4/3] shrink-0 basis-[80%] snap-start overflow-hidden rounded-card sm:basis-[60%] md:aspect-auto md:basis-auto md:snap-align-none"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={altOf(img)}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
