import 'server-only';
import type { PropertyDetail } from './queries';
import type { Locale } from '@/i18n/config';
import { formatPrice } from './format';
import { getCountryName } from '@/lib/i18n/countries';
// Re-export so existing call sites (formatPrice from '@/lib/listings/seo')
// keep working. Client components should import from './format' directly.
export { formatPrice };

const SITE_ORIGIN = 'https://advertisehomes.online';

/**
 * Resolve the canonical EN/ES URLs for a property. Returns `null` for either
 * locale that doesn't have a slug yet (single-language listings — see
 * `DECISIONS.md` "Drop the no-language-fallback rule"; we don't fabricate
 * cross-language URLs).
 */
export function listingUrls(p: PropertyDetail): { en: string | null; es: string | null } {
  return {
    en: p.slugEn ? `${SITE_ORIGIN}/en/properties/${p.slugEn}-${p.shortId}` : null,
    es: p.slugEs ? `${SITE_ORIGIN}/es/propiedades/${p.slugEs}-${p.shortId}` : null,
  };
}

interface BuildMetaArgs {
  property: PropertyDetail;
  locale: Locale;
}

interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  alternates: { en?: string; es?: string; xDefault?: string };
  ogImage: string | null;
  imageUrls: string[];
}

/** Build the SEO metadata block from a property + locale. */
export function buildSeoMeta({ property: p, locale }: BuildMetaArgs): SeoMeta {
  const title = (locale === 'es' ? p.titleEs : p.titleEn) ?? p.titleEn ?? p.titleEs ?? 'Listing';
  const description =
    (locale === 'es' ? p.descriptionEs : p.descriptionEn) ??
    p.descriptionEn ??
    p.descriptionEs ??
    '';

  // Trim description to ~155 chars for meta description, breaking on the last
  // sentence boundary if possible.
  const truncated = description.length > 155 ? description.slice(0, 155).replace(/\s+\S*$/, '…') : description;

  const price = formatPrice(p.priceCents, p.currency, locale);
  const bedSegment = p.bedrooms != null ? ` · ${p.bedrooms}bd` : '';
  const cityCountry = `${p.city}, ${getCountryName(p.countryCode, locale)}`;
  const seoTitle = `${price} · ${title}${bedSegment} · ${cityCountry}`;

  const seoDescription = truncated || `${title} — ${cityCountry}. ${price}.`;

  const urls = listingUrls(p);
  const canonical = (locale === 'es' ? urls.es : urls.en) ?? urls.en ?? urls.es ?? `${SITE_ORIGIN}`;

  const alternates: SeoMeta['alternates'] = {};
  if (urls.en) alternates.en = urls.en;
  if (urls.es) alternates.es = urls.es;
  alternates.xDefault = urls.en ?? urls.es ?? canonical;

  // CF Images URLs follow `https://imagedelivery.net/{accountHash}/{imageId}/{variant}`.
  // When `NEXT_PUBLIC_CF_IMAGES_HASH` isn't set (e.g. Cloudflare Images
  // not yet provisioned, or running tests), we cannot build a real image
  // URL — emit null/empty instead. The page-level `<head>` then omits
  // og:image entirely rather than emitting a broken `imagedelivery.net/${cf_images_hash}/...`
  // URL that would visibly fail in social-card debuggers.
  const cfImagesHash = process.env.NEXT_PUBLIC_CF_IMAGES_HASH;
  const primaryImage = p.images.find((i) => i.isPrimary) ?? p.images[0];
  const ogImage =
    cfImagesHash && primaryImage?.cfImageId
      ? `https://imagedelivery.net/${cfImagesHash}/${primaryImage.cfImageId}/og`
      : null;
  const imageUrls = cfImagesHash
    ? p.images
        .filter((i) => i.cfImageId)
        .map(
          (i) =>
            `https://imagedelivery.net/${cfImagesHash}/${i.cfImageId}/full`,
        )
    : [];

  return { title: seoTitle, description: seoDescription, canonical, alternates, ogImage, imageUrls };
}

/**
 * Build a `RealEstateListing` JSON-LD object for the property. Per HANDOFF
 * §16.3 / spec §16.3 — `address` directly as `PostalAddress`, `offers` as
 * `Offer`, `floorSize` as `QuantitativeValue` with `MTK` (m²). Geo block
 * (lat/lng) is intentionally omitted in v1 — generated columns or an RPC
 * for parsed PostGIS coordinates will land alongside the map view.
 */
export function buildListingJsonLd({ property: p, locale }: BuildMetaArgs) {
  const meta = buildSeoMeta({ property: p, locale });

  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    '@id': meta.canonical,
    url: meta.canonical,
    name: meta.title,
    description: meta.description,
    inLanguage: locale,
    datePosted: p.publishedAt ?? p.createdAt,
    dateModified: p.updatedAt,
    address: {
      '@type': 'PostalAddress',
      addressLocality: p.city,
      addressRegion: p.stateRegion ?? undefined,
      addressCountry: p.countryCode,
      postalCode: p.postalCode ?? undefined,
      // Street line is shown only when the agent opted in.
      streetAddress: p.displayAddress ? (p.addressLine ?? undefined) : undefined,
    },
    offers: {
      '@type': 'Offer',
      price: (p.priceCents / 100).toFixed(0),
      priceCurrency: p.currency,
      availability: 'https://schema.org/InStock',
    },
  };

  if (p.bedrooms != null) node.numberOfBedrooms = p.bedrooms;
  if (p.bathrooms != null) node.numberOfBathroomsTotal = p.bathrooms;
  if (p.areaSqm != null) {
    node.floorSize = {
      '@type': 'QuantitativeValue',
      value: p.areaSqm,
      unitCode: 'MTK',
    };
  }
  if (meta.imageUrls.length > 0) node.image = meta.imageUrls;

  return node;
}
