import { formatPrice } from '@/lib/listings/format';
import type { Locale } from '@/i18n/config';

/**
 * Manual-share caption generators per platform per locale. Phase 3 of the
 * social-distribution spec — the copy-paste stopgap that runs while
 * Phase 4+ (OAuth + auto-posting) waits on Meta + LinkedIn app review.
 *
 * Pure functions: same input → same output, no side effects, edge-safe.
 * The caller (manual-share-module.tsx) renders these strings inside a
 * modal with a per-platform copy button.
 *
 * URL convention: every link is UTM-tagged so `dashboard/analytics`
 * surfaces which platform sent each visit. Shape:
 *   ?utm_source={facebook|instagram|linkedin|whatsapp}&utm_medium=social&utm_campaign=agent_share
 */

export type SharePlatform = 'facebook' | 'instagram' | 'linkedin' | 'whatsapp';

export interface ShareInput {
  title: string;
  city: string;
  countryDisplay: string;
  priceCents: number;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  /** Absolute URL to the listing in the active locale, WITHOUT UTM params.
   *  Templates append the per-platform `utm_source`. */
  baseUrl: string;
  locale: Locale;
}

const CAMPAIGN = 'agent_share';

function withUtm(baseUrl: string, source: SharePlatform): string {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}utm_source=${source}&utm_medium=social&utm_campaign=${CAMPAIGN}`;
}

function specsLine(
  bedrooms: number | null,
  bathrooms: number | null,
  areaSqm: number | null,
  locale: Locale,
): string | null {
  const parts: string[] = [];
  if (bedrooms != null && bedrooms > 0) {
    parts.push(`🛏 ${bedrooms}`);
  }
  if (bathrooms != null && bathrooms > 0) {
    parts.push(`🛁 ${bathrooms}`);
  }
  if (areaSqm != null && areaSqm > 0) {
    parts.push(`📐 ${Math.round(areaSqm)} m²`);
  }
  if (parts.length === 0) return null;
  return parts.join(locale === 'es' ? ' · ' : ' · ');
}

function citySlug(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

interface FormattedFacts {
  priceLabel: string;
  specs: string | null;
  cityCountry: string;
  cityHashtag: string;
}

function formatFacts(input: ShareInput): FormattedFacts {
  return {
    priceLabel: formatPrice(input.priceCents, input.currency, input.locale),
    specs: specsLine(input.bedrooms, input.bathrooms, input.areaSqm, input.locale),
    cityCountry: `${input.city}, ${input.countryDisplay}`,
    cityHashtag: citySlug(input.city),
  };
}

export function captionFacebook(input: ShareInput): string {
  const facts = formatFacts(input);
  const url = withUtm(input.baseUrl, 'facebook');
  if (input.locale === 'es') {
    return [
      input.title,
      '',
      `📍 ${facts.cityCountry}`,
      `💰 ${facts.priceLabel}`,
      ...(facts.specs ? [facts.specs] : []),
      '',
      `👉 ${url}`,
      '',
      `#inmuebles #aho #${facts.cityHashtag}`,
    ].join('\n');
  }
  return [
    input.title,
    '',
    `📍 ${facts.cityCountry}`,
    `💰 ${facts.priceLabel}`,
    ...(facts.specs ? [facts.specs] : []),
    '',
    `👉 ${url}`,
    '',
    `#realestate #aho #${facts.cityHashtag}`,
  ].join('\n');
}

/** Instagram captions don't render clickable links — append the URL after
 *  the body and tell the agent to put the link in their bio. */
export function captionInstagram(input: ShareInput): string {
  const facts = formatFacts(input);
  const url = withUtm(input.baseUrl, 'instagram');
  if (input.locale === 'es') {
    return [
      `✨ ${input.title}`,
      '',
      `📍 ${facts.cityCountry}`,
      `💰 ${facts.priceLabel}`,
      ...(facts.specs ? [facts.specs] : []),
      '',
      'Enlace en bio o copia y pega:',
      url,
      '',
      `#inmuebles #aho #bienesraices #${facts.cityHashtag} #propiedadesenventa`,
    ].join('\n');
  }
  return [
    `✨ ${input.title}`,
    '',
    `📍 ${facts.cityCountry}`,
    `💰 ${facts.priceLabel}`,
    ...(facts.specs ? [facts.specs] : []),
    '',
    'Link in bio or copy and paste:',
    url,
    '',
    `#realestate #aho #propertiesforsale #${facts.cityHashtag} #homesforsale`,
  ].join('\n');
}

export function captionLinkedIn(input: ShareInput): string {
  const facts = formatFacts(input);
  const url = withUtm(input.baseUrl, 'linkedin');
  if (input.locale === 'es') {
    return [
      `Nuevo en el mercado: ${input.title}`,
      '',
      `Ubicación: ${facts.cityCountry}`,
      `Precio: ${facts.priceLabel}`,
      ...(facts.specs ? [`Detalles: ${facts.specs}`] : []),
      '',
      `Más información: ${url}`,
      '',
      '#bienesraices #inmuebles #inversion',
    ].join('\n');
  }
  return [
    `New on the market: ${input.title}`,
    '',
    `Location: ${facts.cityCountry}`,
    `Price: ${facts.priceLabel}`,
    ...(facts.specs ? [`Details: ${facts.specs}`] : []),
    '',
    `Full details: ${url}`,
    '',
    '#realestate #property #investment',
  ].join('\n');
}

/** WhatsApp body — same content but in plain prose without hashtags. The
 *  client also generates a `wa.me/?text=...` deep-link from this string. */
export function captionWhatsApp(input: ShareInput): string {
  const facts = formatFacts(input);
  const url = withUtm(input.baseUrl, 'whatsapp');
  if (input.locale === 'es') {
    return [
      input.title,
      `${facts.cityCountry} · ${facts.priceLabel}`,
      ...(facts.specs ? [facts.specs] : []),
      '',
      url,
    ].join('\n');
  }
  return [
    input.title,
    `${facts.cityCountry} · ${facts.priceLabel}`,
    ...(facts.specs ? [facts.specs] : []),
    '',
    url,
  ].join('\n');
}

/** WhatsApp share-to-anyone deep-link. Unlike the lead-pre-fill flow
 *  (`buildWhatsAppLink`), this opens WhatsApp's chat picker with no
 *  recipient — the agent picks who to send to. */
export function whatsappShareLink(body: string): string {
  return `https://wa.me/?text=${encodeURIComponent(body)}`;
}

/** Convenience: every caption keyed by platform, plus the WhatsApp deep-link. */
export function buildAllCaptions(input: ShareInput): {
  facebook: string;
  instagram: string;
  linkedin: string;
  whatsapp: string;
  whatsappShareUrl: string;
} {
  const whatsapp = captionWhatsApp(input);
  return {
    facebook: captionFacebook(input),
    instagram: captionInstagram(input),
    linkedin: captionLinkedIn(input),
    whatsapp,
    whatsappShareUrl: whatsappShareLink(whatsapp),
  };
}
