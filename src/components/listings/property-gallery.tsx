'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
  /** Intrinsic pixel dimensions from the DB (uploaded resolution). When
   *  set, threaded into <img width/height> so the browser can reserve the
   *  correct slot in advance, eliminating CLS on the gallery row. Both
   *  may be null on legacy rows that pre-date the columns. */
  width?: number | null;
  height?: number | null;
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
 * Property detail page gallery — Client Component.
 *
 * Three contracts (per PO directives 2026-05-02):
 *
 *   1. **No-crop AND no-bands.** Photos render at their exact uploaded
 *      dimensions, framed by NOTHING. No `object-cover` (would crop), no
 *      `object-contain` inside a fixed cell (would letterbox into the
 *      muted background). Each image is just an `<img>` element with
 *      `w-auto h-auto` and viewport caps; the image's intrinsic ratio
 *      drives the layout 1:1.
 *
 *   2. **Click-to-zoom lightbox.** Tap any photo → fullscreen overlay
 *      portal'd into <body>, image centered at viewport size, prev /
 *      next arrows + photo counter + close button. ESC + arrow keys
 *      work too. Closing returns to the listing page in place.
 *
 *   3. **SEO-rich alt + visible caption ("leyenda").** Every <img> alt
 *      combines title + property type + transaction phrase + city +
 *      country. The primary photo also has a visible <figcaption>
 *      below the gallery — the same description for human readers.
 *      See `lib/listings/photo-seo.ts`.
 *
 * Layout:
 *   Mobile (< md): primary at viewport-width, natural height; caption;
 *     horizontal scroll-snap row of thumbs at fixed h-32, varying widths.
 *   Desktop (md+): primary centered with max-h-[600px] cap; caption;
 *     thumbs row at fixed h-40, varying widths, fits naturally.
 *
 * Why Client Component: the lightbox needs interactive state + portal.
 * Server-rendered first paint still emits the gallery HTML (Next.js SSRs
 * Client Components), so SEO alt text + figcaption are in the document
 * source for crawlers exactly as before.
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
  const t = useTranslations('gallery');
  const sorted = [...images]
    .filter((img) => img.cfImageId || img.r2Key)
    .sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (b.isPrimary && !a.isPrimary) return 1;
      return a.position - b.position;
    });

  const total = sorted.length;
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Body scroll lock + ESC + arrow keys while lightbox is open.
  useEffect(() => {
    if (lightboxIdx === null) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxIdx(null);
      else if (e.key === 'ArrowRight') {
        setLightboxIdx((i) => (i === null ? null : (i + 1) % total));
      } else if (e.key === 'ArrowLeft') {
        setLightboxIdx((i) => (i === null ? null : (i - 1 + total) % total));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [lightboxIdx, total]);

  const next = useCallback(() => {
    setLightboxIdx((i) => (i === null ? null : (i + 1) % total));
  }, [total]);
  const prev = useCallback(() => {
    setLightboxIdx((i) => (i === null ? null : (i - 1 + total) % total));
  }, [total]);

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
          {t('noPhotos')}
        </span>
      </div>
    );
  }

  const primary = sorted[0]!;
  const secondaries = sorted.slice(1);

  // SEO-friendly alt text per photo. Caller-supplied alt_text override
  // takes precedence when set.
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
  /**
   * Multi-variant srcset for the LCP hero:
   *   - card (600×400)   → phones (~414 CSS px @ 2× DPI = ~828 device px)
   *   - hero (900×600)   → tablets + typical desktop (~800-900 display)
   *                         CREATED 2026-05-16 specifically to plug the
   *                         Lighthouse "image is larger than displayed
   *                         dimensions" finding — the `public` 1366×768
   *                         was being pulled for an 800px display slot,
   *                         wasting ~70 KiB on LCP.
   *   - public (1366×768) → wide desktops / retina
   * The browser picks the smallest source ≥ the rendered size,
   * guided by the `sizes` hint set on the <img>.
   */
  const primaryUrlMobile = buildImageUrl({
    cfImageId: primary.cfImageId,
    r2Key: primary.r2Key,
    variant: 'card',
  });
  const primaryUrlMid = buildImageUrl({
    cfImageId: primary.cfImageId,
    r2Key: primary.r2Key,
    variant: 'hero',
  });
  const srcsetParts: string[] = [];
  if (primaryUrlMobile && primaryUrlMobile !== primaryUrl) {
    srcsetParts.push(`${primaryUrlMobile} 600w`);
  }
  if (primaryUrlMid && primaryUrlMid !== primaryUrl && primaryUrlMid !== primaryUrlMobile) {
    srcsetParts.push(`${primaryUrlMid} 900w`);
  }
  if (primaryUrl) {
    srcsetParts.push(`${primaryUrl} 1366w`);
  }
  const primarySrcSet = srcsetParts.length > 1 ? srcsetParts.join(', ') : undefined;
  if (!primaryUrl) {
    return (
      <div
        aria-hidden="true"
        className="flex aspect-[16/9] w-full items-center justify-center border border-dashed border-border-strong/40 bg-surface shadow-whisper md:rounded-card dark:bg-surface-deep"
      >
        <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('noPhotos')}
        </span>
      </div>
    );
  }

  // Pre-resolve all image URLs for the lightbox + thumb row. We use the
  // `public` variant for the primary + lightbox; `card` variant for thumbs.
  const allUrls = sorted
    .map((img) =>
      buildImageUrl({
        cfImageId: img.cfImageId,
        r2Key: img.r2Key,
        variant: 'public',
      }),
    )
    .filter((u): u is string => u !== null);

  return (
    <>
      {/* Break out of the parent container's px-4 on mobile so the
          gallery is true edge-to-edge. md+ stays inside container. */}
      <figure className="-mx-4 md:mx-0">
        {/* Primary photo — clickable to open lightbox. No surrounding
            cell / bg / letterbox. Image renders at its uploaded ratio. */}
        <button
          type="button"
          onClick={() => setLightboxIdx(0)}
          aria-label={t('openPhoto')}
          className="block w-full md:flex md:justify-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={primaryUrl}
            {...(primarySrcSet
              ? {
                  srcSet: primarySrcSet,
                  // Mobile fills the viewport. On md+ the image caps at
                  // max-h-[600px] with auto width, so for typical 16:9
                  // hero aspect the rendered width sits ~1067 px tall-
                  // bound. Tightened 2026-05-16 from a flat 1366px (the
                  // largest variant) after Lighthouse showed the browser
                  // pulling that variant for an 800px-wide display slot.
                  sizes: '(max-width: 768px) 100vw, (max-width: 1024px) 800px, 1067px',
                }
              : {})}
            alt={altOf(primary, 1)}
            {...(primary.width && primary.height
              ? { width: primary.width, height: primary.height }
              : {})}
            className="block h-auto w-full max-w-full cursor-zoom-in md:h-auto md:w-auto md:max-h-[600px] md:rounded-card"
            loading="eager"
            fetchPriority="high"
            decoding="async"
          />
        </button>

        <figcaption className="px-4 py-2 text-xs leading-relaxed text-helper md:mt-3 md:px-0 md:text-sm">
          {primaryCaption}
        </figcaption>

        {/* Thumbnail row — fixed height, varying width per image's
            natural ratio. Horizontal scroll on mobile (snap), fits
            naturally on desktop. */}
        {secondaries.length > 0 && (
          <div className="mt-2 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-2 md:mt-3 md:px-0 md:pb-0">
            {secondaries.map((img, idx) => {
              const url = buildImageUrl({
                cfImageId: img.cfImageId,
                r2Key: img.r2Key,
                variant: 'card',
              });
              if (!url) return null;
              const realIndex = idx + 1; // 0 is primary
              return (
                <button
                  key={img.cfImageId ?? img.r2Key}
                  type="button"
                  onClick={() => setLightboxIdx(realIndex)}
                  aria-label={t('openPhoto')}
                  className="shrink-0 snap-start"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={altOf(img, realIndex + 1)}
                    {...(img.width && img.height
                      ? { width: img.width, height: img.height }
                      : {})}
                    className="block h-32 w-auto cursor-zoom-in rounded-card md:h-40"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              );
            })}
          </div>
        )}
      </figure>

      {/* Lightbox overlay — portal'd into <body> to escape any parent
          containing block. Same pattern as the mobile menu fix. */}
      {mounted &&
        lightboxIdx !== null &&
        createPortal(
          <Lightbox
            urls={allUrls}
            index={lightboxIdx}
            altOf={(idx) => altOf(sorted[idx]!, idx + 1)}
            caption={primaryCaption}
            onClose={() => setLightboxIdx(null)}
            onPrev={prev}
            onNext={next}
          />,
          document.body,
        )}
    </>
  );
}

interface LightboxProps {
  urls: string[];
  index: number;
  altOf: (idx: number) => string;
  caption: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function Lightbox({
  urls,
  index,
  altOf,
  caption,
  onClose,
  onPrev,
  onNext,
}: LightboxProps) {
  const t = useTranslations('gallery');
  const total = urls.length;
  const url = urls[index];
  if (!url) return null;
  const counterLabel = t('photoCounter', { position: index + 1, total });
  const closeLabel = t('backToListing');
  const prevLabel = t('previous');
  const nextLabel = t('next');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={closeLabel}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white"
    >
      {/* Top bar: counter + close. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3 md:px-6"
      >
        <span className="text-sm font-medium tabular-nums text-white/80">
          {counterLabel}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-medium transition hover:bg-white/20 active:scale-95"
        >
          <X aria-hidden="true" className="h-4 w-4" strokeWidth={2.25} />
          <span>{closeLabel}</span>
        </button>
      </div>

      {/* Image canvas — flex-1 fills remaining height; image is
          max-h-full max-w-full so it scales to fit the viewport without
          ever cropping. Click on the image area (not the image itself)
          falls through to the overlay's onClick → closes. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4 md:p-8">
        {/* Prev button — left edge, vertically centered. */}
        {total > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPrev();
            }}
            aria-label={prevLabel}
            className="absolute left-2 top-1/2 z-[1] inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-95 md:left-4 md:h-14 md:w-14"
          >
            <ChevronLeft aria-hidden="true" className="h-6 w-6" strokeWidth={2.25} />
          </button>
        )}

        {/* Next button — right edge. */}
        {total > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNext();
            }}
            aria-label={nextLabel}
            className="absolute right-2 top-1/2 z-[1] inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20 active:scale-95 md:right-4 md:h-14 md:w-14"
          >
            <ChevronRight aria-hidden="true" className="h-6 w-6" strokeWidth={2.25} />
          </button>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={altOf(index)}
          onClick={(e) => e.stopPropagation()}
          className="block max-h-full max-w-full select-none"
          decoding="async"
        />
      </div>

      {/* Bottom caption — same SEO description, smaller in lightbox. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 border-t border-white/10 px-4 py-3 text-center text-xs leading-relaxed text-white/70 md:px-6 md:text-sm"
      >
        {caption}
      </div>
    </div>
  );
}
