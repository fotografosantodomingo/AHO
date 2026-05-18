import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale, narrowContentLocale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import {
  fetchListingContact,
  fetchPropertyByShortId,
  parseSlugParam,
} from '@/lib/listings/queries';
import { buildSeoMeta, buildListingJsonLd, listingUrls } from '@/lib/listings/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import { buildGraph, type JsonLdNode } from '@/lib/seo/jsonld';
import { buildWhatsAppLink } from '@/lib/leads/whatsapp';
// ContactForm lazy-loaded below — it's below the fold + bundles ~50 KiB
// of zod + react-hook-form + Turnstile widget. Keeping it out of the
// initial JS payload helps LCP/TBT on the public listing page.
// (see const ContactForm = nextDynamic(...) further down.)
import nextDynamic from 'next/dynamic';
import { PropertyGallery } from '@/components/listings/property-gallery';
import { buildImageUrl } from '@/lib/listings/image-url';
import { FactsAndFeatures } from '@/components/listings/facts-and-features';
import { PriceTile } from '@/components/listings/price-tile';
import { getCountryName } from '@/lib/i18n/countries';
import { fetchPriceHistory } from '@/lib/listings/price-history';
import { findSimilarListings } from '@/lib/listings/similar';
import { fetchAgentReviewSummaryForListing } from '@/lib/reviews/agent-summary';
import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserFavoriteIds } from '@/lib/listings/favorites';
import { FavoriteButton } from '@/components/listings/favorite-button';
import { TrackPropertyView } from '@/components/listings/track-property-view';
import { TrackedLink } from '@/components/listings/tracked-link';
import { TrackGalleryOpen } from '@/components/listings/track-gallery-open';
import { AiChatWidget, type WidgetLocale } from '@/components/chat/ai-chat-widget';

// Below-fold components — dynamic-imported to keep them off the initial
// JS payload. They render plenty far down the page that hydrating them
// in the first batch hurts LCP/TBT without payoff. next/dynamic with
// loading=null emits an empty placeholder; layout doesn't shift because
// each component has a wrapping <section> that holds height as content
// streams in.
const PriceHistory = nextDynamic(
  () => import('@/components/listings/price-history').then((m) => ({ default: m.PriceHistory })),
  { loading: () => null },
);
const ContactForm = nextDynamic(
  () => import('@/components/listings/contact-form').then((m) => ({ default: m.ContactForm })),
  { loading: () => null },
);
const SimilarHomes = nextDynamic(
  () => import('@/components/listings/similar-homes').then((m) => ({ default: m.SimilarHomes })),
  { loading: () => null },
);
const RecentlyViewed = nextDynamic(
  () => import('@/components/listings/recently-viewed').then((m) => ({ default: m.RecentlyViewed })),
  { loading: () => null },
);

export const runtime = 'edge';
// Force dynamic rendering on every request. Without this, Cloudflare
// Pages occasionally serves a stale HTML snapshot of the listing page
// — including a stale agent avatar URL — even after the underlying
// `profiles.avatar_url` has been updated. The Edge cost is one fresh
// Supabase round-trip per visit; the UX cost of stale agent photos is
// reported by users as "the photo I uploaded never shows up on my
// listing." 2026-05-07.
export const dynamic = 'force-dynamic';

/**
 * Property detail page — `/{locale}/properties/{slug}-{shortId}` (en) and
 * `/{locale}/propiedades/{slug}-{shortId}` (es) via next-intl path
 * translations.
 *
 * The slug param contains both the SEO slug and the immutable 6-char short
 * ID. We look up by short ID; if the slug doesn't match the canonical
 * current slug, we 301 to the canonical.
 *
 * Returns full SEO metadata (title, description, canonical, hreflang
 * alternates, OpenGraph, Twitter Card, RealEstateListing JSON-LD).
 */

type PageParams = { locale: string; slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};

  const parsed = parseSlugParam(slug);
  if (!parsed) return {};

  const property = await fetchPropertyByShortId(parsed.shortId);
  if (!property) return {};

  const meta = buildSeoMeta({ property, locale: locale as Locale });

  return {
    title: meta.title,
    description: meta.description,
    alternates: {
      canonical: meta.canonical,
      languages: {
        ...(meta.alternates.en ? { en: meta.alternates.en } : {}),
        ...(meta.alternates.es ? { es: meta.alternates.es } : {}),
        ...(meta.alternates.xDefault ? { 'x-default': meta.alternates.xDefault } : {}),
      },
    },
    openGraph: {
      type: 'website',
      url: meta.canonical,
      title: meta.title,
      description: meta.description,
      ...(meta.ogImage ? { images: [{ url: meta.ogImage, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: meta.title,
      description: meta.description,
      ...(meta.ogImage ? { images: [meta.ogImage] } : {}),
    },
    robots:
      property.status === 'active' && property.publishedAt
        ? { index: true, follow: true }
        : { index: false, follow: false },
  };
}

export default async function PropertyDetailPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const parsed = parseSlugParam(slug);
  if (!parsed) notFound();

  const property = await fetchPropertyByShortId(parsed.shortId);
  if (!property) notFound();

  // Slug stability: if the URL slug differs from the canonical current slug
  // for this locale, 301 to the canonical. This keeps SEO authority on a
  // single URL even when titles change.
  const canonicalSlug = typedLocale === 'es' ? property.slugEs : property.slugEn;
  if (canonicalSlug && canonicalSlug !== parsed.slugPart) {
    // Build via localePath against the registered `/properties/[slug]`
    // PATHNAMES entry, then interpolate the slug — keeps the segment
    // ('propiedades' / 'properties') a single source of truth.
    const stem = localePath(typedLocale, '/properties/[slug]').replace('/[slug]', '');
    redirect(`${stem}/${canonicalSlug}-${property.shortId}`);
  }

  const t = await getTranslations({ locale: typedLocale, namespace: 'property' });

  // Buyer favorite state for this listing — single-row lookup. Anon users
  // get { favorited: false, isAuthed: false } and the heart bounces to /signin.
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const favoriteIds = await getUserFavoriteIds(supabase, userId, [property.id]);
  const isFavorited = favoriteIds.has(property.id);

  const titleForLocale = typedLocale === 'es' ? property.titleEs : property.titleEn;
  const descriptionForLocale =
    typedLocale === 'es' ? property.descriptionEs : property.descriptionEn;
  const fallbackTitle = property.titleEn ?? property.titleEs ?? '';
  const fallbackDescription = property.descriptionEn ?? property.descriptionEs ?? '';
  const usingFallback = !titleForLocale && !!fallbackTitle;
  const title = titleForLocale ?? fallbackTitle;
  const description = descriptionForLocale ?? fallbackDescription;

  const transactionLabel = t(`transactionType.${property.transactionType}`);
  const periodLabel = property.pricePeriod ? t(`pricePeriod.${property.pricePeriod}`) : '';

  const urls = listingUrls(property);

  // Public-safe contact info — only present when listing is active+published
  // (the SECURITY DEFINER function filters that). WhatsApp link is built only
  // if the agent's phone passes the digit-count sanity check.
  const contact = await fetchListingContact(property.id);

  // Agent review aggregate — when the listing's creator has published
  // reviews on AHO, wire them into the RealEstateAgent JSON-LD node as
  // an AggregateRating block. Google uses this to render the gold-stars
  // rich snippet on the SERP card. Null when no reviews → JSON-LD just
  // omits the block (a fake/zero rating actively hurts rich results).
  const reviewSummary = await fetchAgentReviewSummaryForListing(property.id);

  // JSON-LD built after `contact` + review summary are loaded so we can
  // wire the agent as `seller` AND attach an AggregateRating to that
  // RealEstateAgent @graph node when reviews exist.
  const jsonLd = buildListingJsonLd({
    property,
    locale: typedLocale,
    contact,
    reviewSummary,
  });

  // Price-history timeline. Reads audit_log via the public-read policy
  // added in 0014 — only event kinds (price_changed, sold, rented) on
  // active+published properties. Empty/single-row results render nothing.
  const priceHistory = await fetchPriceHistory({
    propertyId: property.id,
    publishedAt: property.publishedAt,
    currentPriceCents: property.priceCents,
    currency: property.currency,
  });

  // Similar homes — same city + same transaction_type + ±20% price.
  // Empty result hides the section entirely.
  const similar = await findSimilarListings({
    selfId: property.id,
    city: property.city,
    countryCode: property.countryCode,
    transactionType: property.transactionType,
    priceCents: property.priceCents,
  });

  // BreadcrumbList JSON-LD — schema.org canonical breadcrumbs for SERP.
  // Path: AHO → Country → City → This listing. Country + city land on the
  // existing /properties-in/[country] and /properties-in/[country]/[city]
  // surfaces respectively.
  const { NEXT_PUBLIC_SITE_URL: _site } = publicEnv();
  const countryLandingStem = localePath(typedLocale, '/properties-in/[country]').replace(
    '/[country]',
    '',
  );
  const countryLanding = `${_site}${countryLandingStem}/${property.countryCode.toLowerCase()}`;
  const citySlugified = property.city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const cityLanding = `${countryLanding}/${citySlugified}`;
  // Resolve the primary image URLs so we can emit a <link rel="preload">
  // ahead of the gallery. The browser kicks off the fetch as soon as it
  // parses the head, instead of waiting until the gallery component
  // mounts and the parser reaches the <img> — knocks ~2 seconds off
  // LCP on a typical mobile connection.
  const primaryImage =
    property.images.find((i) => i.isPrimary) ?? property.images[0];
  const primaryUrlPublic = primaryImage
    ? buildImageUrl({
        cfImageId: primaryImage.cfImageId,
        r2Key: primaryImage.r2Key,
        variant: 'public',
      })
    : null;
  const primaryUrlCard = primaryImage
    ? buildImageUrl({
        cfImageId: primaryImage.cfImageId,
        r2Key: primaryImage.r2Key,
        variant: 'card',
      })
    : null;

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'AHO',
        item: `${_site}/${typedLocale}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: getCountryName(property.countryCode, typedLocale),
        item: countryLanding,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: property.city,
        item: cityLanding,
      },
      {
        '@type': 'ListItem',
        position: 4,
        name: title,
      },
    ],
  };

  const canonicalUrl = (typedLocale === 'es' ? urls.es : urls.en) ?? urls.en ?? urls.es ?? '';
  // Prefer the agent's dedicated WhatsApp number if set; fall back to
  // their primary phone. Keeps the contract simple for agents who use
  // the same number for both.
  const waPhone = contact?.agentWhatsappPhone ?? contact?.agentPhone;
  const whatsappLink = buildWhatsAppLink({
    agentPhone: waPhone,
    listingTitle: title,
    city: property.city,
    url: canonicalUrl,
    locale: narrowContentLocale(typedLocale),
  });
  // Tel link (single phone for click-to-call). E.164-ish — strip
  // non-digits for the href but show the formatted version.
  const telPhone = contact?.agentPhone;
  const telHref = telPhone ? `tel:${telPhone.replace(/[^+0-9]/g, '')}` : null;

  return (
    <>
      {/* Preload the primary image with a responsive imageSrcSet so the
          browser's preload scanner kicks off the LCP fetch the moment
          it parses the head, before React hydrates the gallery. Next.js
          15 hoists <link> elements rendered from server components into
          the document <head>. Skipped when there's no primary image. */}
      {primaryUrlPublic && primaryUrlCard && primaryUrlPublic !== primaryUrlCard && (
        <link
          rel="preload"
          as="image"
          imageSrcSet={`${primaryUrlCard} 600w, ${primaryUrlPublic} 1366w`}
          imageSizes="(max-width: 768px) 100vw, 1366px"
        />
      )}
      {primaryUrlPublic && primaryUrlPublic === primaryUrlCard && (
        <link rel="preload" as="image" href={primaryUrlPublic} />
      )}

      {/* JSON-LD lives in the body — Next.js dedupes scripts in head, but for
          structured data the body works equivalently for crawlers. Single
          @graph: buildListingJsonLd already returns one (WebSite +
          Organization + RealEstateListing + Agent + FAQPage + a
          generic listing-shaped BreadcrumbList). We MERGE the page-level
          richer geographic BreadcrumbList in by replacing the generic
          one inside the listing graph — emitting two BreadcrumbList
          nodes confuses Google. */}
      <JsonLd
        node={(() => {
          const innerGraph = (jsonLd['@graph'] as JsonLdNode[]).filter(
            (n) => n['@type'] !== 'BreadcrumbList',
          );
          return buildGraph([...innerGraph, breadcrumbJsonLd as JsonLdNode]);
        })()}
      />

      <main className="mx-auto max-w-5xl px-6 py-8 md:py-10">
        {usingFallback && (
          <div
            role="note"
            className="mb-6 rounded-card border border-warn/30 bg-warn-bg/40 px-4 py-3 text-sm text-warn dark:border-warn/40"
          >
            {t('translationPending')}
          </div>
        )}

        {/* Hero gallery — primary photo + up to 4 secondaries. Token-styled
            empty placeholder if no images yet (no fake stock photos).
            Wrapped in TrackGalleryOpen so the first click anywhere in
            the gallery records an `image_gallery_open` event for the
            agent dashboard analytics. */}
        <TrackGalleryOpen propertyId={property.id}>
          <PropertyGallery
            images={property.images}
            locale={typedLocale}
            title={title}
            transactionType={property.transactionType}
            propertyType={property.propertyType}
            city={property.city}
            countryDisplay={getCountryName(property.countryCode, typedLocale)}
          />
        </TrackGalleryOpen>

        {/* Title block. Two columns on md+: location/title on the left,
            transaction-type chip + price stacked on the right. */}
        <header className="mt-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
          <div className="space-y-2">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {property.city}, {getCountryName(property.countryCode, typedLocale)}
            </p>
            <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[40px] md:leading-[1.12]">
              {title}
            </h1>
            {property.neighborhood && (
              <p className="text-sm text-helper">
                {property.neighborhood}
                {property.displayAddress && property.addressLine
                  ? ` · ${property.addressLine}`
                  : ''}
              </p>
            )}
          </div>
          <div className="md:text-right">
            <span className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink shadow-whisper dark:bg-surface-deep dark:text-ink-inverse">
              {transactionLabel}
            </span>
            <div className="mt-2">
              <PriceTile
                priceCents={property.priceCents}
                currency={property.currency}
                locale={typedLocale}
                periodLabel={periodLabel}
                size="lg"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 md:justify-end">
              <FavoriteButton
                propertyId={property.id}
                initialFavorited={isFavorited}
                isAuthed={!!userId}
                locale={typedLocale}
                size="detail"
              />
            </div>
          </div>
        </header>

        {/* Spec strip — pill row instead of a dl, more visually consistent
            with the listing card. Bd / ba / m² / property type. */}
        <ul className="mt-6 flex flex-wrap gap-2">
          {property.bedrooms != null && (
            <li className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm shadow-whisper dark:bg-surface-deep">
              <span className="font-medium tabular-nums">{property.bedrooms}</span>
              <span className="text-helper">
                {t('bedrooms_other', { count: property.bedrooms }).replace(
                  /^[0-9]+\s*/,
                  '',
                )}
              </span>
            </li>
          )}
          {property.bathrooms != null && (
            <li className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm shadow-whisper dark:bg-surface-deep">
              <span className="font-medium tabular-nums">{property.bathrooms}</span>
              <span className="text-helper">
                {t('bathrooms_other', { count: Math.ceil(property.bathrooms) }).replace(
                  /^[0-9]+\s*/,
                  '',
                )}
              </span>
            </li>
          )}
          {property.areaSqm != null && (
            <li className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-sm shadow-whisper dark:bg-surface-deep">
              <span className="font-medium tabular-nums">{property.areaSqm}</span>
              <span className="text-helper">m²</span>
            </li>
          )}
        </ul>

        {description && (
          <section className="mt-10 rounded-card border border-border bg-surface p-6 leading-relaxed shadow-whisper dark:bg-surface-deep">
            <p className="whitespace-pre-line text-ink-muted dark:text-ink-inverse-muted">
              {description}
            </p>
          </section>
        )}

        <FactsAndFeatures
          features={property.features}
          bedrooms={property.bedrooms}
          bathrooms={property.bathrooms}
          areaSqm={property.areaSqm}
          lotSizeSqm={property.lotSizeSqm}
          yearBuilt={property.yearBuilt}
          propertyType={property.propertyType}
          amenities={property.amenities}
          currency={property.currency}
          neighborhood={property.neighborhood}
          city={property.city}
          stateRegion={property.stateRegion}
          locale={typedLocale}
        />

        <PriceHistory events={priceHistory} locale={typedLocale} />

        <SimilarHomes listings={similar} locale={typedLocale} />

        {/* Recently viewed rail — excludes the current property so the
            user doesn't see "you viewed this listing" on the listing
            they're already on. Self-hides when no other recent views. */}
        <RecentlyViewed locale={typedLocale} excludeId={property.id} />

        {/* Fire-and-forget client tracker — POSTs to /api/properties/[id]/view
            on mount, sets the aho_anon_id cookie if absent + records the
            view. Hidden render (returns null). */}
        <TrackPropertyView propertyId={property.id} />

        {/* Contact section — agent card (left) + lead form (right) on md+.
            On mobile they stack. Only renders contact details when the
            listing is active+published (gated by SECURITY DEFINER RPC).
            WhatsApp link prefers the agent's dedicated WhatsApp number,
            falls back to their main phone. */}
        {/* id="contact" is the anchor target for Schema.org's
            tourBookingPage (set in lib/listings/seo.ts → buildListingJsonLd)
            — Google links to `/properties/<slug>#contact` from rich
            results when offering the "Schedule a tour" CTA. */}
        <section
          id="contact"
          aria-labelledby="contact-heading"
          className="mt-12 grid gap-6 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep md:grid-cols-[1fr_1.2fr]"
        >
          <div className="space-y-4">
            <h2 id="contact-heading" className="font-brand text-xl font-bold">
              {t('contactAgent')}
            </h2>

            {/* Agent identity row — photo + name + org. */}
            <div className="flex items-start gap-3">
              {contact?.agentAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.agentAvatarUrl}
                  alt={contact.agentFullName ?? contact.orgName}
                  className="h-14 w-14 rounded-full border border-border object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-muted font-brand text-base font-semibold text-action dark:bg-surface-dark dark:text-action-dark"
                >
                  {(contact?.agentFullName ?? contact?.orgName ?? '·')
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase() ?? '')
                    .join('')}
                </div>
              )}
              <div className="min-w-0">
                {contact?.agentFullName && (
                  <p className="font-brand text-base font-semibold tracking-tight">
                    {contact.agentFullName}
                  </p>
                )}
                {contact?.orgName && (
                  <p className="text-sm text-helper">{contact.orgName}</p>
                )}
                {property.orgPublicSlug && (
                  <a
                    href={`/${typedLocale}/agents/${property.orgPublicSlug}`}
                    className="mt-1.5 inline-flex h-8 items-center rounded-full border border-border-strong bg-surface px-3 text-xs font-medium text-action transition hover:bg-action/5 dark:bg-surface-deep dark:text-action-dark dark:hover:bg-action-dark/10"
                  >
                    {t('seeFullProfile')}
                  </a>
                )}
                {/* Prominent WhatsApp CTA right under the agent header —
                    duplicates the contact-CTA strip lower in the page but
                    catches the buyer's eye next to the agent's name + face.
                    Highest-converting channel in the DR/LatAm market per
                    PO direction 2026-05-16. Only renders when the agent
                    has set a phone (whatsapp_phone OR phone fallback) on
                    their /dashboard/profile. */}
                {whatsappLink && (
                  <TrackedLink
                    propertyId={property.id}
                    eventType="whatsapp_click"
                    href={whatsappLink}
                    rel="noopener noreferrer"
                    target="_blank"
                    className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-sm font-semibold text-white shadow-whisper transition hover:bg-emerald-700 active:scale-95 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-emerald-950"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.555-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
                    </svg>
                    {t('chatOnWhatsapp')}
                  </TrackedLink>
                )}
              </div>
            </div>

            {/* Specialties + languages tags. */}
            {((contact?.agentSpecialties?.length ?? 0) > 0 ||
              (contact?.agentLanguagesSpoken?.length ?? 0) > 0) && (
              <div className="space-y-2">
                {(contact?.agentSpecialties?.length ?? 0) > 0 && (
                  <ul className="flex flex-wrap gap-1.5">
                    {contact!.agentSpecialties.map((s) => (
                      <li
                        key={`spec-${s}`}
                        className="inline-flex items-center rounded-md bg-action/10 px-2 py-0.5 text-[11px] font-medium text-action dark:bg-action-dark/15 dark:text-action-dark"
                      >
                        {s.replace(/_/g, ' ')}
                      </li>
                    ))}
                  </ul>
                )}
                {(contact?.agentLanguagesSpoken?.length ?? 0) > 0 && (
                  <p className="text-xs text-helper">
                    {t('speaksLabel')}:{' '}
                    {contact!.agentLanguagesSpoken.join(' · ')}
                  </p>
                )}
              </div>
            )}

            {/* Bio snippet. Long bios truncated visually but fully indexable. */}
            {contact?.agentBio && (
              <p className="line-clamp-4 text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                {contact.agentBio}
              </p>
            )}

            {/* Contact CTAs. WhatsApp first (highest conversion in DR market),
                then phone, then social links as small icon-style chips. */}
            <div className="flex flex-wrap gap-2">
              {whatsappLink && (
                <TrackedLink
                  propertyId={property.id}
                  eventType="whatsapp_click"
                  href={whatsappLink}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex h-9 items-center rounded-lg border border-emerald-600 bg-emerald-50 px-3 text-sm font-medium text-emerald-900 shadow-whisper transition hover:bg-emerald-100 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
                >
                  {t('chatOnWhatsapp')}
                </TrackedLink>
              )}
              {telHref && (
                <TrackedLink
                  propertyId={property.id}
                  eventType="phone_click"
                  href={telHref}
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {t('callLabel')}
                </TrackedLink>
              )}
              {contact?.agentWebsiteUrl && (
                <a
                  href={contact.agentWebsiteUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong/40 px-3 text-xs text-helper transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  Web ↗
                </a>
              )}
              {contact?.agentFacebookUrl && (
                <a
                  href={contact.agentFacebookUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong/40 px-3 text-xs text-helper transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  Facebook ↗
                </a>
              )}
              {contact?.agentInstagramUrl && (
                <a
                  href={contact.agentInstagramUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong/40 px-3 text-xs text-helper transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  Instagram ↗
                </a>
              )}
              {contact?.agentLinkedinUrl && (
                <a
                  href={contact.agentLinkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong/40 px-3 text-xs text-helper transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  LinkedIn ↗
                </a>
              )}
            </div>
          </div>
          <ContactForm propertyId={property.id} />
        </section>

        {/* Locale switching happens exclusively in the header dropdown
            now (PO directive 2026-05-07). The previous footer link
            duplicated the header switcher and added clutter. Crawlers
            consume the same alternates from the <head> hreflang already
            emitted in generateMetadata. */}
      </main>

      {/* AI customer-service widget — Phase 2 web-chat surface. Bottom-
          LEFT during the coexistence period with Tawk (bottom-right).
          Only renders when the listing has a primary agent id (it's
          required for the API to know who the buyer is "talking to"). */}
      {property.createdBy && (
        <AiChatWidget
          agentId={property.createdBy}
          agentName={contact?.agentFullName ?? contact?.orgName ?? 'the agent'}
          agentAvatarUrl={contact?.agentAvatarUrl ?? null}
          propertyId={property.id}
          buyerLocale={typedLocale as WidgetLocale}
        />
      )}
    </>
  );
}
