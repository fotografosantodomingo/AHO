import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import {
  fetchListingContact,
  fetchPropertyByShortId,
  parseSlugParam,
} from '@/lib/listings/queries';
import { buildSeoMeta, buildListingJsonLd, formatPrice, listingUrls } from '@/lib/listings/seo';
import { buildWhatsAppLink } from '@/lib/leads/whatsapp';
import { ContactForm } from '@/components/listings/contact-form';
import { PropertyGallery } from '@/components/listings/property-gallery';

export const runtime = 'edge';

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
    const pathSegment = typedLocale === 'es' ? 'propiedades' : 'properties';
    redirect(`/${typedLocale}/${pathSegment}/${canonicalSlug}-${property.shortId}`);
  }

  const t = await getTranslations({ locale: typedLocale, namespace: 'property' });

  const titleForLocale = typedLocale === 'es' ? property.titleEs : property.titleEn;
  const descriptionForLocale =
    typedLocale === 'es' ? property.descriptionEs : property.descriptionEn;
  const fallbackTitle = property.titleEn ?? property.titleEs ?? '';
  const fallbackDescription = property.descriptionEn ?? property.descriptionEs ?? '';
  const usingFallback = !titleForLocale && !!fallbackTitle;
  const title = titleForLocale ?? fallbackTitle;
  const description = descriptionForLocale ?? fallbackDescription;

  const price = formatPrice(property.priceCents, property.currency, typedLocale);
  const transactionLabel = t(`transactionType.${property.transactionType}`);
  const periodLabel = property.pricePeriod ? t(`pricePeriod.${property.pricePeriod}`) : '';

  const jsonLd = buildListingJsonLd({ property, locale: typedLocale });
  const urls = listingUrls(property);

  // Public-safe contact info — only present when listing is active+published
  // (the SECURITY DEFINER function filters that). WhatsApp link is built only
  // if the agent's phone passes the digit-count sanity check.
  const contact = await fetchListingContact(property.id);
  const canonicalUrl = (typedLocale === 'es' ? urls.es : urls.en) ?? urls.en ?? urls.es ?? '';
  const whatsappLink = buildWhatsAppLink({
    agentPhone: contact?.agentPhone,
    listingTitle: title,
    city: property.city,
    url: canonicalUrl,
    locale: typedLocale,
  });

  return (
    <>
      {/* JSON-LD lives in the body — Next.js dedupes scripts in head, but for
          structured data the body works equivalently for crawlers. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="mx-auto max-w-5xl px-6 py-8 md:py-10">
        {usingFallback && (
          <div
            role="status"
            className="mb-6 rounded-card border border-warn/30 bg-warn-bg/40 px-4 py-3 text-sm text-warn dark:border-warn/40"
          >
            {t('translationPending')}
          </div>
        )}

        {/* Hero gallery — primary photo + up to 4 secondaries. Token-styled
            empty placeholder if no images yet (no fake stock photos). */}
        <PropertyGallery
          images={property.images}
          locale={typedLocale}
          fallbackAlt={title}
        />

        {/* Title block. Two columns on md+: location/title on the left,
            transaction-type chip + price stacked on the right. */}
        <header className="mt-8 grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
          <div className="space-y-2">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {property.city}, {property.countryCode}
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
            <p className="mt-2 font-brand text-3xl font-bold tabular-nums tracking-tight md:text-[34px]">
              {price}
              {periodLabel ? (
                <span className="ml-1 text-base font-normal text-helper">{periodLabel}</span>
              ) : null}
            </p>
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

        {/* Contact section — WhatsApp button + lead capture form. Only renders
            when the listing is active+published (which is also when contact is
            visible per HANDOFF §6.3 — anon sees the form, never the agent's
            email/phone directly). */}
        <section
          aria-labelledby="contact-heading"
          className="mt-12 grid gap-6 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep md:grid-cols-2"
        >
          <div>
            <h2 id="contact-heading" className="font-brand text-xl font-bold">
              {t('contactAgent')}
            </h2>
            {contact?.orgName && (
              <p className="mt-1 text-sm text-helper">{contact.orgName}</p>
            )}
            {whatsappLink && (
              <a
                href={whatsappLink}
                rel="noopener noreferrer"
                target="_blank"
                className="mt-4 inline-flex h-10 items-center rounded-lg border border-emerald-600 bg-emerald-50 px-4 text-sm font-medium text-emerald-900 shadow-whisper transition hover:bg-emerald-100 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
              >
                {t('chatOnWhatsapp')}
              </a>
            )}
          </div>
          <ContactForm propertyId={property.id} />
        </section>

        {/* Footer alternates — useful for crawlers that may not parse hreflang
            from the head, plus a usability cue if the user lands on the
            "wrong" locale. */}
        <footer className="mt-16 border-t border-border pt-6 text-xs text-helper">
          {urls.en && urls.es && (
            <p>
              <a className="underline" href={typedLocale === 'es' ? urls.en : urls.es}>
                {typedLocale === 'es' ? 'View in English' : 'Ver en Español'}
              </a>
            </p>
          )}
        </footer>
      </main>
    </>
  );
}
