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
  // Prefer the agent's dedicated WhatsApp number if set; fall back to
  // their primary phone. Keeps the contract simple for agents who use
  // the same number for both.
  const waPhone = contact?.agentWhatsappPhone ?? contact?.agentPhone;
  const whatsappLink = buildWhatsAppLink({
    agentPhone: waPhone,
    listingTitle: title,
    city: property.city,
    url: canonicalUrl,
    locale: typedLocale,
  });
  // Tel link (single phone for click-to-call). E.164-ish — strip
  // non-digits for the href but show the formatted version.
  const telPhone = contact?.agentPhone;
  const telHref = telPhone ? `tel:${telPhone.replace(/[^+0-9]/g, '')}` : null;

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

        {/* Contact section — agent card (left) + lead form (right) on md+.
            On mobile they stack. Only renders contact details when the
            listing is active+published (gated by SECURITY DEFINER RPC).
            WhatsApp link prefers the agent's dedicated WhatsApp number,
            falls back to their main phone. */}
        <section
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
                    {typedLocale === 'es' ? 'Idiomas' : 'Speaks'}:{' '}
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
                <a
                  href={whatsappLink}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex h-9 items-center rounded-lg border border-emerald-600 bg-emerald-50 px-3 text-sm font-medium text-emerald-900 shadow-whisper transition hover:bg-emerald-100 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-100 dark:hover:bg-emerald-950/60"
                >
                  {t('chatOnWhatsapp')}
                </a>
              )}
              {telHref && (
                <a
                  href={telHref}
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {typedLocale === 'es' ? 'Llamar' : 'Call'}
                </a>
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
