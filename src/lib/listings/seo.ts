import 'server-only';
import type { PropertyDetail, ListingContact } from './queries';
import type { Locale } from '@/i18n/config';
import { formatPrice } from './format';
import { getCountryName } from '@/lib/i18n/countries';
import { parseFeatures } from './features';
// Re-export so existing call sites (formatPrice from '@/lib/listings/seo')
// keep working. Client components should import from './format' directly.
export { formatPrice };

const SITE_ORIGIN = 'https://advertisehomes.online';
const PUBLISHER_NAME = 'Advertise Homes Online';

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
  /** Per-image objects (width / height / caption) for richer JSON-LD. */
  imageObjects: Array<{
    url: string;
    width: number | null;
    height: number | null;
    caption: string | null;
  }>;
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

  const cityCountry = `${p.city}, ${getCountryName(p.countryCode, locale)}`;
  // Title shape (changed 2026-05-16 — was "{price} · {title} · {bedSegment} ·
  // {cityCountry}", typically 100+ chars and price-first which the 2026-05-16
  // SEO audit flagged as truncated + unhelpful when the price is the lowest-
  // intent signal). New format puts the human-readable title FIRST (highest
  // CTR signal), then key facts, then city+country, then brand. Caps at ~70
  // chars to dodge Google's 580-pixel truncation. Price stays in the meta
  // description + JSON-LD Offer where it's still indexable but not eating
  // SERP-title real estate.
  const factSegments: string[] = [];
  if (p.bedrooms != null) factSegments.push(`${p.bedrooms}bd`);
  if (p.areaSqm != null) factSegments.push(`${p.areaSqm} m²`);
  const facts = factSegments.length > 0 ? ` · ${factSegments.join(' · ')}` : '';
  // Truncate title body if combined output would exceed 65 chars (leaves
  // headroom for ' | AHO' suffix).
  const tail = `${facts} · ${cityCountry} | AHO`;
  const titleBudget = Math.max(20, 70 - tail.length);
  const trimmedTitle =
    title.length > titleBudget ? title.slice(0, titleBudget - 1).replace(/\s+\S*$/, '') + '…' : title;
  const seoTitle = `${trimmedTitle}${tail}`;

  // Keep price available for description fallback below.
  const price = formatPrice(p.priceCents, p.currency, locale);

  // Description fallback chain — ensures the <meta name="description"> tag
  // ALWAYS has content, even on listings with empty descriptions (Lighthouse
  // SEO audit 2026-05-16 flagged "Document does not have a meta description"
  // on a real listing that lacked descriptionEn/Es). The fallback synthesizes
  // a one-liner from facts we always have.
  const bbSegment =
    p.bedrooms != null && p.bathrooms != null
      ? ` ${p.bedrooms} bed, ${p.bathrooms} bath.`
      : '';
  const areaSegment = p.areaSqm != null ? ` ${p.areaSqm} m².` : '';
  const synthDescription =
    `${title} in ${cityCountry}. ${price}${p.pricePeriod === 'monthly' ? '/mo' : ''}.${bbSegment}${areaSegment} See full details, photos, and contact the agent on AHO.`.trim();
  const seoDescription = truncated || synthDescription;

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
  const imageObjects: SeoMeta['imageObjects'] = cfImagesHash
    ? p.images
        .filter((i) => i.cfImageId)
        .map((i) => ({
          url: `https://imagedelivery.net/${cfImagesHash}/${i.cfImageId}/full`,
          width: i.width,
          height: i.height,
          caption: (locale === 'es' ? i.altTextEs : i.altTextEn) ?? null,
        }))
    : [];

  return { title: seoTitle, description: seoDescription, canonical, alternates, ogImage, imageUrls, imageObjects };
}

/**
 * Map `properties.property_type` to the closest Schema.org Accommodation
 * subtype. Falls back to the generic RealEstateListing wrapper's @type when
 * we don't have a confident mapping — better to be conservative than to
 * misclassify (a "land" listing as "House" would mislead search bots).
 */
function accommodationTypeFor(propertyType: string): string | null {
  const t = propertyType.toLowerCase();
  if (t === 'house' || t === 'villa' || t === 'townhouse' || t === 'bungalow') {
    return t === 'house' ? 'House' : 'SingleFamilyResidence';
  }
  if (t === 'apartment' || t === 'studio' || t === 'condo' || t === 'penthouse') return 'Apartment';
  if (t === 'land' || t === 'plot') return 'Place';
  if (t === 'commercial' || t === 'office' || t === 'retail') return 'CommercialProperty';
  return null;
}

interface BuildJsonLdArgs extends BuildMetaArgs {
  /** Optional agent contact — when present, embedded as the listing's
   *  `seller` + `broker` (a RealEstateAgent). Improves search rich-snippet
   *  eligibility because Google likes seeing a real human linked to the
   *  property. */
  contact?: ListingContact | null;
  /** Optional aggregate-rating block when the agent has reviews on AHO.
   *  Reviews are agent-scoped, not listing-scoped — but Google's rich
   *  results spec allows attaching the agent's aggregateRating to each
   *  of their listings as long as we make the relationship clear via
   *  `itemReviewed`. */
  reviewSummary?: { count: number; avg: number } | null;
}

/**
 * Build a comprehensive `RealEstateListing` JSON-LD object. State-of-the-art
 * for 2026 — covers every field Schema.org defines that we have data for,
 * plus the AHO publisher attribution + agent-as-seller wiring search engines
 * use for rich snippets.
 *
 * Returns an array of @graph nodes so the consumer can render one
 * `<script type="application/ld+json">` block per page that contains:
 *   1. WebSite (publisher context, sitelinks search box eligibility)
 *   2. Organization (AHO as the publisher / brand)
 *   3. RealEstateListing (the listing itself, with nested accommodation,
 *      offer, address, geo when available, image array, amenityFeature[],
 *      additionalProperty[] for non-canonical attributes like yearBuilt,
 *      lotSize, parking, heating)
 *   4. RealEstateAgent (the seller, when contact info is available)
 *   5. BreadcrumbList (Home → Properties in {Country} → {City} → listing)
 *
 * The @graph form is preferred over multiple separate <script> blocks per
 * Google's documentation — single fetch, single parse, explicit relationships
 * between nodes.
 */
export function buildListingJsonLd({ property: p, locale, contact, reviewSummary }: BuildJsonLdArgs) {
  const meta = buildSeoMeta({ property: p, locale });
  const canonical = meta.canonical;
  const accommodationType = accommodationTypeFor(p.propertyType);

  // -------- 1. WebSite (publisher) --------
  const websiteNode: Record<string, unknown> = {
    '@type': 'WebSite',
    '@id': `${SITE_ORIGIN}/#website`,
    url: SITE_ORIGIN,
    name: PUBLISHER_NAME,
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    inLanguage: locale,
  };

  // -------- 2. Organization (AHO) --------
  const orgNode: Record<string, unknown> = {
    '@type': 'Organization',
    '@id': `${SITE_ORIGIN}/#organization`,
    name: PUBLISHER_NAME,
    url: SITE_ORIGIN,
    logo: `${SITE_ORIGIN}/icon.png`,
    sameAs: [
      'https://www.facebook.com/profile.php?id=61580170197960',
      'https://www.linkedin.com/company/advertise-homes-online',
    ],
  };

  // -------- 3. RealEstateListing (main) --------
  const offerNode: Record<string, unknown> = {
    '@type': 'Offer',
    price: (p.priceCents / 100).toFixed(0),
    priceCurrency: p.currency,
    availability: p.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    url: canonical,
    seller: contact?.agentFullName
      ? { '@id': `${canonical}#agent` }
      : { '@id': `${SITE_ORIGIN}/#organization` },
    ...(p.publishedAt ? { validFrom: p.publishedAt } : {}),
  };

  // For rentals, attach a UnitPriceSpecification so search engines know
  // the price is /period rather than total. Sale listings use the plain
  // Offer.price.
  if (p.transactionType !== 'sale' && p.pricePeriod) {
    const referenceQuantity: Record<string, unknown> = {
      '@type': 'QuantitativeValue',
      value: 1,
      unitCode:
        p.pricePeriod === 'monthly'
          ? 'MON'
          : p.pricePeriod === 'weekly'
            ? 'WEE'
            : p.pricePeriod === 'nightly'
              ? 'DAY'
              : 'ANN',
    };
    offerNode.priceSpecification = {
      '@type': 'UnitPriceSpecification',
      price: (p.priceCents / 100).toFixed(0),
      priceCurrency: p.currency,
      referenceQuantity,
    };
  }

  const addressNode: Record<string, unknown> = {
    '@type': 'PostalAddress',
    addressLocality: p.city,
    addressCountry: p.countryCode,
    ...(p.stateRegion ? { addressRegion: p.stateRegion } : {}),
    ...(p.postalCode ? { postalCode: p.postalCode } : {}),
    ...(p.displayAddress && p.addressLine ? { streetAddress: p.addressLine } : {}),
  };

  // Parse the `features` jsonb once — used by both additionalProperty[]
  // (numeric / enum facts) and amenityFeature[] (boolean facts) below.
  const f = parseFeatures(p.features);

  // additionalProperty[] — surface non-canonical facts (yearBuilt, lotSize,
  // parking, heating, etc.) without polluting the top-level node. Google
  // reads these for the "Property details" card in rich results.
  const additionalProperty: Array<Record<string, unknown>> = [];
  if (p.yearBuilt != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'yearBuilt',
      value: p.yearBuilt,
    });
  }
  if (p.lotSizeSqm != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'lotSize',
      value: p.lotSizeSqm,
      unitCode: 'MTK',
    });
  }
  additionalProperty.push({
    '@type': 'PropertyValue',
    name: 'transactionType',
    value: p.transactionType,
  });
  additionalProperty.push({
    '@type': 'PropertyValue',
    name: 'propertyType',
    value: p.propertyType,
  });

  // Extra facts from the `features` jsonb. Each one is a
  // PropertyValue so Google's "Property details" rich card has a richer
  // payload to render. Skip undefined fields (CLAUDE.md hard rule #8).
  if (f.parkingSpaces != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'parkingSpaces',
      value: f.parkingSpaces,
    });
  }
  if (f.parkingType != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'parkingType',
      value: f.parkingType,
    });
  }
  if (f.stories != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'stories',
      value: f.stories,
    });
  }
  if (f.heatingFuel != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'heatingFuel',
      value: f.heatingFuel,
    });
  }
  if (f.cooling != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'cooling',
      value: f.cooling,
    });
  }
  if (f.exteriorMaterial != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'exteriorMaterial',
      value: f.exteriorMaterial,
    });
  }
  if (f.roofType != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'roofType',
      value: f.roofType,
    });
  }
  if (f.lastRenovationYear != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'lastRenovationYear',
      value: f.lastRenovationYear,
    });
  }
  if (f.water != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'water',
      value: f.water,
    });
  }
  if (f.sewer != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'sewer',
      value: f.sewer,
    });
  }
  if (f.schoolDistrict != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'schoolDistrict',
      value: f.schoolDistrict,
    });
  }
  if (f.distanceToBeachMeters != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'distanceToBeachMeters',
      value: f.distanceToBeachMeters,
      unitCode: 'MTR',
    });
  }
  if (f.hoaFeeCents != null && f.hoaFeePeriod != null) {
    // Emit HOA fee as a PropertyValue with the period encoded in the
    // name (e.g. "hoaFeeMonthly"). Schema.org doesn't have a first-
    // class HOA fee field; this keeps the structured signal intact.
    const periodCapped = f.hoaFeePeriod === 'monthly' ? 'Monthly' : 'Annual';
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: `hoaFee${periodCapped}`,
      value: (f.hoaFeeCents / 100).toFixed(0),
      unitText: p.currency,
    });
  }
  if (f.propertyTaxAnnualCents != null) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'propertyTaxAnnual',
      value: (f.propertyTaxAnnualCents / 100).toFixed(0),
      unitText: p.currency,
    });
  }
  if (f.listingTerms && f.listingTerms.length > 0) {
    additionalProperty.push({
      '@type': 'PropertyValue',
      name: 'listingTerms',
      value: f.listingTerms.join(', '),
    });
  }

  // amenityFeature[] — one LocationFeatureSpecification per unit
  // amenity. Free-text amenities map to `name`; we set `value: true`
  // because Schema.org's LocationFeatureSpecification.value is a
  // boolean for binary features. Boolean features (furnished, balcony,
  // terrace, basement, gated, securitySystem, solar, laundryInUnit,
  // publicTransitNearby) become entries here when true. Community-
  // level amenities are folded in too — Google doesn't distinguish
  // between unit- and community-level for amenityFeature, but the
  // total signal is richer.
  const amenityFeature: Array<Record<string, unknown>> = (p.amenities ?? []).map((a) => ({
    '@type': 'LocationFeatureSpecification',
    name: a,
    value: true,
  }));
  for (const a of f.communityAmenities ?? []) {
    amenityFeature.push({
      '@type': 'LocationFeatureSpecification',
      name: a,
      value: true,
    });
  }
  const booleanFeatures: Array<[keyof typeof f, string]> = [
    ['furnished', 'Furnished'],
    ['laundryInUnit', 'In-unit laundry'],
    ['balcony', 'Balcony'],
    ['terrace', 'Terrace'],
    ['basement', 'Basement'],
    ['gated', 'Gated community'],
    ['securitySystem', 'Security system'],
    ['solar', 'Solar'],
    ['publicTransitNearby', 'Public transit nearby'],
  ];
  for (const [key, name] of booleanFeatures) {
    if (f[key] === true) {
      amenityFeature.push({
        '@type': 'LocationFeatureSpecification',
        name,
        value: true,
      });
    }
  }

  // VideoObject schema — not emitted today because we don't yet store
  // video tours on properties. When that lands (Phase: scope TBD), the
  // schema slot is: listingNode.video = { '@type': 'VideoObject',
  // name, description, thumbnailUrl, contentUrl, uploadDate, duration
  // (ISO 8601 PT3M5S) }. Add as an array when multi-video. Google
  // surfaces these in "Property videos" rich card for high-quality
  // listings — Zillow heavily uses this on agent video walkthroughs.

  // image[] — explicit ImageObject array (with width/height) is more
  // valuable than a flat URL list. Google's "Image rich results" needs
  // dimensions to qualify.
  const imageNodes = meta.imageObjects.length > 0
    ? meta.imageObjects.map((img) => ({
        '@type': 'ImageObject',
        url: img.url,
        ...(img.width ? { width: img.width } : {}),
        ...(img.height ? { height: img.height } : {}),
        ...(img.caption ? { caption: img.caption } : {}),
      }))
    : meta.imageUrls;

  const listingNode: Record<string, unknown> = {
    '@type': 'RealEstateListing',
    '@id': canonical,
    mainEntityOfPage: canonical,
    url: canonical,
    name: meta.title,
    headline: meta.title,
    description: meta.description,
    inLanguage: locale,
    isAccessibleForFree: true,
    datePosted: p.publishedAt ?? p.createdAt,
    dateModified: p.updatedAt,
    address: addressNode,
    offers: offerNode,
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
    ...(imageNodes.length > 0 ? { image: imageNodes } : {}),
    ...(amenityFeature.length > 0 ? { amenityFeature } : {}),
    ...(additionalProperty.length > 0 ? { additionalProperty } : {}),
  };

  // Numerical accommodation attributes — Schema.org puts these on the listing
  // directly OR on a nested Accommodation node. Putting them on the listing
  // is simpler and Google accepts it (as does Zillow).
  if (p.bedrooms != null) listingNode.numberOfBedrooms = p.bedrooms;
  if (p.bathrooms != null) listingNode.numberOfBathroomsTotal = p.bathrooms;
  if (p.bedrooms != null && p.bathrooms != null) {
    listingNode.numberOfRooms = p.bedrooms + p.bathrooms;
  }

  // petsAllowed — Schema.org first-class boolean. Only emit when the
  // agent has actually stated a policy; "restricted" → omit because
  // the boolean field can't express "with conditions" and Google
  // would render an inaccurate yes/no.
  if (f.petPolicy === 'allowed') listingNode.petsAllowed = true;
  else if (f.petPolicy === 'none') listingNode.petsAllowed = false;

  // tourBookingPage — anchor on the listing's own page that scrolls
  // to the agent contact form. The detail page renders a `#contact`
  // anchor for the inquiry form. Surfaces Google's "Schedule a tour"
  // rich card link when present.
  listingNode.tourBookingPage = `${canonical}#contact`;

  // GeoCoordinates — when the listing has precise lat/lng (migration
  // 0007 maintains these via trigger from PostGIS `location`).
  // Powers Google Maps rich results + the "View on map" feature in
  // SERPs for property listings. Address-only listings (no coords)
  // skip this block; Google falls back to geocoding the address.
  if (p.latitude != null && p.longitude != null) {
    listingNode.geo = {
      '@type': 'GeoCoordinates',
      latitude: p.latitude,
      longitude: p.longitude,
    };
  }
  if (p.areaSqm != null) {
    listingNode.floorSize = {
      '@type': 'QuantitativeValue',
      value: p.areaSqm,
      unitCode: 'MTK',
    };
  }

  // Nested Accommodation typed by propertyType when we can map it. Adds
  // a second-level @type (House / Apartment / etc.) so search engines have
  // both the "this is a listing" signal and the "this is a villa" signal.
  if (accommodationType) {
    const accomNode: Record<string, unknown> = {
      '@type': accommodationType,
      name: meta.title,
      ...(p.areaSqm != null
        ? {
            floorSize: {
              '@type': 'QuantitativeValue',
              value: p.areaSqm,
              unitCode: 'MTK',
            },
          }
        : {}),
      ...(p.bedrooms != null ? { numberOfBedrooms: p.bedrooms } : {}),
      ...(p.bathrooms != null ? { numberOfBathroomsTotal: p.bathrooms } : {}),
      ...(p.yearBuilt != null ? { yearBuilt: p.yearBuilt } : {}),
    };
    listingNode.accommodation = accomNode;
  }

  // -------- 4. RealEstateAgent (seller, when present) --------
  const nodes: Array<Record<string, unknown>> = [websiteNode, orgNode, listingNode];

  if (contact?.agentFullName) {
    const sameAs: string[] = [];
    if (contact.agentWebsiteUrl) sameAs.push(contact.agentWebsiteUrl);
    if (contact.agentFacebookUrl) sameAs.push(contact.agentFacebookUrl);
    if (contact.agentInstagramUrl) sameAs.push(contact.agentInstagramUrl);
    if (contact.agentLinkedinUrl) sameAs.push(contact.agentLinkedinUrl);

    const agentNode: Record<string, unknown> = {
      '@type': 'RealEstateAgent',
      '@id': `${canonical}#agent`,
      name: contact.agentFullName,
      worksFor: { '@id': `${SITE_ORIGIN}/#organization` },
      ...(contact.agentBio ? { description: contact.agentBio } : {}),
      ...(contact.agentAvatarUrl ? { image: contact.agentAvatarUrl } : {}),
      ...(contact.agentPhone ? { telephone: contact.agentPhone } : {}),
      ...(contact.agentSpecialties?.length
        ? { knowsAbout: contact.agentSpecialties }
        : {}),
      ...(sameAs.length > 0 ? { sameAs } : {}),
      ...(reviewSummary && reviewSummary.count > 0
        ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: reviewSummary.avg.toFixed(1),
              reviewCount: reviewSummary.count,
              bestRating: '5',
              worstRating: '1',
            },
          }
        : {}),
    };
    nodes.push(agentNode);
  }

  // -------- 5. FAQPage (auto-generated from property facts) --------
  // Google rewards FAQPage schema with the "People also ask" rich
  // result — accordion of Q&A directly in the SERP card. The questions
  // map to common buyer queries on real-estate listings; answers come
  // straight from the property's structured data so they're always
  // accurate (no hallucination risk). Only emit Q&As whose answer is
  // non-null — questions about missing facts would be honest but
  // worthless for SERP impact.
  const faqEntries: Array<{ q: string; a: string }> = [];
  const faqPrice = formatPrice(p.priceCents, p.currency, locale);
  if (p.priceCents > 0) {
    faqEntries.push({
      q: locale === 'es' ? `¿Cuál es el precio?` : `What is the price?`,
      a:
        locale === 'es'
          ? `El precio es ${faqPrice}${p.transactionType === 'rent' && p.pricePeriod === 'monthly' ? ' al mes' : ''}.`
          : `The price is ${faqPrice}${p.transactionType === 'rent' && p.pricePeriod === 'monthly' ? ' per month' : ''}.`,
    });
  }
  if (p.bedrooms != null && p.bathrooms != null) {
    faqEntries.push({
      q:
        locale === 'es'
          ? `¿Cuántos dormitorios y baños tiene?`
          : `How many bedrooms and bathrooms does it have?`,
      a:
        locale === 'es'
          ? `Tiene ${p.bedrooms} dormitorios y ${p.bathrooms} baños.`
          : `It has ${p.bedrooms} bedrooms and ${p.bathrooms} bathrooms.`,
    });
  }
  if (p.areaSqm != null) {
    faqEntries.push({
      q: locale === 'es' ? `¿Cuál es la superficie?` : `What is the size?`,
      a:
        locale === 'es'
          ? `La superficie es de ${p.areaSqm} m².`
          : `The total floor area is ${p.areaSqm} m².`,
    });
  }
  if (p.city) {
    faqEntries.push({
      q: locale === 'es' ? `¿Dónde se encuentra?` : `Where is it located?`,
      a: `${p.city}, ${getCountryName(p.countryCode, locale)}.`,
    });
  }
  if ((p.amenities ?? []).length > 0) {
    faqEntries.push({
      q:
        locale === 'es'
          ? `¿Qué amenidades incluye?`
          : `What amenities does it include?`,
      a: p.amenities.join(', ') + '.',
    });
  }
  if (faqEntries.length >= 2) {
    nodes.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: faqEntries.map((entry) => ({
        '@type': 'Question',
        name: entry.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: entry.a,
        },
      })),
    });
  }

  // -------- 6. BreadcrumbList --------
  const countryName = getCountryName(p.countryCode, locale);
  const propertiesPath = locale === 'es' ? '/es/propiedades' : '/en/properties';
  const breadcrumbNode: Record<string, unknown> = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: locale === 'es' ? 'Inicio' : 'Home',
        item: `${SITE_ORIGIN}/${locale}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: locale === 'es' ? 'Propiedades' : 'Properties',
        item: `${SITE_ORIGIN}${propertiesPath}`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: `${p.city}, ${countryName}`,
        item: `${SITE_ORIGIN}/${locale}/properties-in/${p.countryCode.toLowerCase()}/${encodeURIComponent(p.city.toLowerCase())}`,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: meta.title,
        item: canonical,
      },
    ],
  };
  nodes.push(breadcrumbNode);

  return {
    '@context': 'https://schema.org',
    '@graph': nodes,
  };
}
