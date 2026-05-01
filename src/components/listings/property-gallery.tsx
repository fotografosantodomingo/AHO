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
 * Mobile (< md): primary takes full width 4:3, secondary thumbs scroll
 *   horizontally below.
 * Desktop (md+): 4-column grid; primary spans cols 1-2 rows 1-2, up to
 *   four secondary thumbs fill cols 3-4 in a 2x2.
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
        className="flex aspect-[16/9] w-full items-center justify-center rounded-card border border-dashed border-border-strong/40 bg-surface shadow-whisper dark:bg-surface-deep"
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
        className="flex aspect-[16/9] w-full items-center justify-center rounded-card border border-dashed border-border-strong/40 bg-surface shadow-whisper dark:bg-surface-deep"
      >
        <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {locale === 'es' ? 'Sin fotos aún' : 'No photos yet'}
        </span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-4 md:grid-rows-2">
      <div className="overflow-hidden rounded-card md:col-span-2 md:row-span-2">
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

      {secondaries.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 md:contents md:overflow-x-visible">
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
                className="aspect-[4/3] shrink-0 basis-1/2 overflow-hidden rounded-card md:aspect-auto md:basis-auto"
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
  );
}
