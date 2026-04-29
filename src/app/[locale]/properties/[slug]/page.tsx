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

      <main className="mx-auto max-w-4xl px-6 py-10">
        {usingFallback && (
          <div
            role="status"
            className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {t('translationPending')}
          </div>
        )}

        <header className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-zinc-500">
            {transactionLabel} · {property.city}, {property.countryCode}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
          <p className="text-2xl font-semibold">
            {price}
            {periodLabel ? <span className="text-base font-normal text-zinc-500"> {periodLabel}</span> : null}
          </p>
        </header>

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {property.bedrooms != null && (
            <div>
              <dt className="text-xs uppercase text-zinc-500">{t('bedrooms_other', { count: property.bedrooms })}</dt>
              <dd className="text-lg font-medium">{property.bedrooms}</dd>
            </div>
          )}
          {property.bathrooms != null && (
            <div>
              <dt className="text-xs uppercase text-zinc-500">
                {t('bathrooms_other', { count: Math.ceil(property.bathrooms) })}
              </dt>
              <dd className="text-lg font-medium">{property.bathrooms}</dd>
            </div>
          )}
          {property.areaSqm != null && (
            <div>
              <dt className="text-xs uppercase text-zinc-500">m²</dt>
              <dd className="text-lg font-medium">{t('areaSqm', { value: property.areaSqm })}</dd>
            </div>
          )}
        </dl>

        {description && (
          <section className="mt-8 prose prose-zinc max-w-none dark:prose-invert">
            <p className="whitespace-pre-line">{description}</p>
          </section>
        )}

        {property.neighborhood && (
          <section className="mt-8 text-sm text-zinc-600 dark:text-zinc-400">
            {property.neighborhood}, {property.city}
            {property.displayAddress && property.addressLine && ` — ${property.addressLine}`}
          </section>
        )}

        {/* Contact section — WhatsApp button + lead capture form. Only renders
            when the listing is active+published (which is also when contact is
            visible per HANDOFF §6.3 — anon sees the form, never the agent's
            email/phone directly). */}
        <section
          aria-labelledby="contact-heading"
          className="mt-12 grid gap-6 rounded-md border border-zinc-200 p-6 dark:border-zinc-800 md:grid-cols-2"
        >
          <div>
            <h2 id="contact-heading" className="text-xl font-semibold">
              {t('contactAgent')}
            </h2>
            {contact?.orgName && (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {contact.orgName}
              </p>
            )}
            {whatsappLink && (
              <a
                href={whatsappLink}
                rel="noopener noreferrer"
                target="_blank"
                className="mt-4 inline-flex h-10 items-center rounded-md border border-emerald-600 bg-emerald-50 px-4 text-sm font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
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
        <footer className="mt-16 border-t border-zinc-200 pt-6 text-xs text-zinc-500 dark:border-zinc-800">
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
