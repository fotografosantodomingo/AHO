'use client';

import { useTranslations } from 'next-intl';
import { formatPrice } from '@/lib/listings/format';
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
 * Client Component (`'use client'`) since the search page now lifts
 * results state into a Client shell (<SearchResultsView>) so the list
 * and map share state. Card-level rendering is identical either way —
 * no useEffect, no event handlers — but the directive is required so
 * the component can be invoked from a Client parent.
 *
 * The image variant URL is `https://imagedelivery.net/{accountHash}/{cfImageId}/card`
 * per HANDOFF §3.4 (`card` = 640w). Renders a placeholder when the
 * listing has no confirmed primary image (early days; no Cloudflare
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
  // We can only link to the locale variant if the listing has that slug.
  // Falls back to the other locale's slug if missing.
  const fallbackSlug = listing.slugEn ?? listing.slugEs;
  const finalSlug = slug ?? fallbackSlug;
  if (!finalSlug) return null; // listing without any slug — shouldn't happen for active+published

  const pathSegment = locale === 'es' ? 'propiedades' : 'properties';
  const href = `/${locale}/${pathSegment}/${finalSlug}-${listing.shortId}`;

  const hash = process.env.NEXT_PUBLIC_CF_IMAGES_HASH;
  const imageUrl =
    listing.primaryImageId && hash
      ? `https://imagedelivery.net/${hash}/${listing.primaryImageId}/card`
      : null;

  const priceLabel = formatPrice(listing.priceCents, listing.currency, locale);
  const periodLabel = listing.pricePeriod ? t(`pricePeriod.${listing.pricePeriod as 'monthly'}`) : '';

  const transactionLabel = t(`transactionType.${listing.transactionType as 'sale'}`);

  return (
    <a
      href={href}
      className="group block overflow-hidden rounded-card border border-border bg-surface shadow-whisper transition-shadow hover:shadow-lg dark:bg-surface-deep"
    >
      <div className="aspect-[4/3] w-full bg-surface-muted dark:bg-surface-dark">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {tCard('viewListing')}
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {transactionLabel} · {listing.city}
          {listing.countryCode && `, ${listing.countryCode}`}
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
        <p className="text-xs text-helper">
          {[
            listing.bedrooms != null && `${listing.bedrooms}bd`,
            listing.bathrooms != null && `${listing.bathrooms}ba`,
            listing.areaSqm != null && `${listing.areaSqm}m²`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </a>
  );
}
