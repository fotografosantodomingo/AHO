'use client';

import { useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/listings/format';
import { buildImageUrl } from '@/lib/listings/image-url';
import { getCountryName } from '@/lib/i18n/countries';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

interface ListingCardProps {
  listing: SearchListing;
  locale: Locale;
}

/**
 * Anonymous-listing card. Pure presentation. Used on the homepage's
 * featured grid, the search/browse results (incl. bbox-driven results),
 * city landing pages, and agent profile pages.
 *
 * Client Component since the search page lifts results state into a Client
 * shell (<SearchResultsView>) so the list and map share state. Card-level
 * rendering is identical either way — no useEffect, no event handlers — but
 * the directive is required so the component can be invoked from a Client
 * parent.
 *
 * The image variant URL is `https://imagedelivery.net/{accountHash}/{cfImageId}/card`
 * per HANDOFF §3.4 (`card` = 640w). Renders a tokenized placeholder when
 * the listing has no confirmed primary image (early days; no Cloudflare
 * Images yet).
 */
export function ListingCard({ listing, locale }: ListingCardProps) {
  const t = useTranslations('property');
  const tCard = useTranslations('card');

  const title =
    (locale === 'es' ? listing.titleEs : listing.titleEn) ??
    listing.titleEn ??
    listing.titleEs ??
    '—';
  const slug = locale === 'es' ? listing.slugEs : listing.slugEn;
  const fallbackSlug = listing.slugEn ?? listing.slugEs;
  const finalSlug = slug ?? fallbackSlug;
  if (!finalSlug) return null;

  const pathSegment = locale === 'es' ? 'propiedades' : 'properties';
  const href = `/${locale}/${pathSegment}/${finalSlug}-${listing.shortId}`;

  const imageUrl = buildImageUrl({
    cfImageId: listing.primaryImageId,
    r2Key: listing.primaryR2Key,
    variant: 'card',
  });

  const priceLabel = formatPrice(listing.priceCents, listing.currency, locale);
  const periodLabel = listing.pricePeriod ? t(`pricePeriod.${listing.pricePeriod as 'monthly'}`) : '';
  const transactionLabel = t(`transactionType.${listing.transactionType as 'sale'}`);

  const specs = [
    listing.bedrooms != null && { value: listing.bedrooms, suffix: 'bd' },
    listing.bathrooms != null && { value: listing.bathrooms, suffix: 'ba' },
    listing.areaSqm != null && { value: listing.areaSqm, suffix: 'm²' },
  ].filter(Boolean) as Array<{ value: number; suffix: string }>;

  return (
    <a
      href={href}
      className="group relative block overflow-hidden rounded-card border border-border bg-surface shadow-whisper transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong/60 hover:shadow-lg dark:bg-surface-deep"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-muted dark:bg-surface-dark">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center"
            style={{
              backgroundImage:
                'linear-gradient(135deg, rgb(97 104 117 / 0.06), rgb(97 104 117 / 0.02))',
            }}
          >
            <span className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {tCard('viewListing')}
            </span>
          </div>
        )}

        {/* Transaction-type pill (top-left). Background is solid surface so
            the chip reads cleanly over any image. */}
        <span className="absolute left-3 top-3 inline-flex items-center rounded-md bg-surface/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink shadow-whisper backdrop-blur-sm dark:bg-surface-dark/90 dark:text-ink-inverse">
          {transactionLabel}
        </span>

        {/* Image-count chip (bottom-right). Only shows when there are
            multiple confirmed images. */}
        {listing.imageCount > 1 && (
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-md bg-ink/75 px-2 py-0.5 text-[11px] font-medium text-ink-inverse-muted backdrop-blur-sm">
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3 w-3"
              fill="currentColor"
            >
              <path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Zm2 .5v6.379l2.293-2.293a1 1 0 0 1 1.414 0L9 9.879l1.293-1.293a1 1 0 0 1 1.414 0L13 9.879V4.5H4Z" />
            </svg>
            {listing.imageCount}
          </span>
        )}
      </div>

      <div className="space-y-2 p-4">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {listing.city}
          {listing.countryCode && `, ${getCountryName(listing.countryCode, locale)}`}
        </p>
        <h3 className="font-brand line-clamp-2 text-[19px] font-bold leading-[1.21] tracking-tight">
          {title}
        </h3>
        <p className="text-lg font-semibold">
          {priceLabel}
          {periodLabel && (
            <span className="ml-1 text-sm font-normal text-helper">{periodLabel}</span>
          )}
        </p>
        {specs.length > 0 && (
          <ul className="flex gap-1.5 pt-1">
            {specs.map((spec) => (
              <li
                key={spec.suffix}
                className="inline-flex items-center rounded-md border border-border bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted tabular-nums dark:bg-surface-dark dark:text-ink-inverse-muted"
              >
                {spec.value}
                <span className="ml-0.5 text-helper">{spec.suffix}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </a>
  );
}
