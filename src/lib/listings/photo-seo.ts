import type { ContentLocale, Locale } from '@/i18n/config';
import { narrowContentLocale } from '@/i18n/config';

/**
 * Build SEO-friendly image alt text + visible caption ("leyenda" in
 * Spanish) for property photos.
 *
 * Per PO directive 2026-05-02: "they have description and leyenda and
 * alt text related to location type of property and keyword like - for
 * sale or rent depend on the type of listing".
 *
 * The output combines:
 *   - listing title
 *   - transaction phrase ("for sale" / "for rent" / "short-term rental")
 *   - property type ("apartment", "villa", etc. — raw English value
 *     stored in the DB; light Spanish translation for the common ones)
 *   - city + country name
 *   - position index for galleries with multiple photos (Photo 2 of 8)
 *
 * Rendered as both:
 *   - `alt` attribute on every <img> (Google Image Search uses this
 *     directly; screen readers announce it)
 *   - `<figcaption>` text on the primary photo (visible "leyenda")
 *
 * Pure function. No env access. Edge-safe.
 */

export type TransactionType = 'sale' | 'rent' | 'short_term';

export interface PhotoSeoArgs {
  title: string;
  transactionType: TransactionType;
  propertyType: string;
  city: string;
  countryDisplay: string;
  /** 1-based index for multi-photo galleries. Position 1 omits the suffix. */
  position?: number;
  /** Total photo count, used to phrase "Photo 2 of 8". */
  total?: number;
  locale: Locale;
}

// Photo SEO labels are content-side; only the two content locales
// (EN/ES) have real translations. Marketing locales fall back to EN
// via narrowContentLocale() at the use sites below.
const TRANSACTION_PHRASE: Record<
  ContentLocale,
  Record<TransactionType, string>
> = {
  en: {
    sale: 'for sale',
    rent: 'for rent',
    short_term: 'short-term rental',
  },
  es: {
    sale: 'en venta',
    rent: 'en alquiler',
    short_term: 'alquiler temporal',
  },
};

// Light translation for the most common property types. Anything not in
// the map falls through as-is (Spanish-speaking visitors will see English
// "loft" or "studio" — acceptable; both are loanwords in es-DO/es-MX).
const PROPERTY_TYPE_LABEL: Record<ContentLocale, Record<string, string>> = {
  en: {
    apartment: 'apartment',
    house: 'house',
    villa: 'villa',
    condo: 'condo',
    townhouse: 'townhouse',
    studio: 'studio',
    loft: 'loft',
    land: 'land',
    commercial: 'commercial property',
    office: 'office',
    other: 'property',
  },
  es: {
    apartment: 'apartamento',
    house: 'casa',
    villa: 'villa',
    condo: 'condominio',
    townhouse: 'casa adosada',
    studio: 'estudio',
    loft: 'loft',
    land: 'terreno',
    commercial: 'inmueble comercial',
    office: 'oficina',
    other: 'inmueble',
  },
};

function propertyTypeLabel(value: string, locale: Locale): string {
  const map = PROPERTY_TYPE_LABEL[narrowContentLocale(locale)];
  return map[value.toLowerCase()] ?? value;
}

/** Sentence-case a string ("for sale" → "For sale"). */
function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return (s[0] ?? '').toUpperCase() + s.slice(1);
}

/**
 * Build the alt-text string. Format:
 *   en: "Modern Villa — villa for sale in Santo Domingo, Dominican Republic (Photo 2 of 8)"
 *   es: "Villa Moderna — villa en venta en Santo Domingo, República Dominicana (Foto 2 de 8)"
 */
export function buildPhotoAlt(args: PhotoSeoArgs): string {
  const cl = narrowContentLocale(args.locale);
  const transaction = TRANSACTION_PHRASE[cl][args.transactionType];
  const type = propertyTypeLabel(args.propertyType, args.locale);
  const inWord = cl === 'es' ? 'en' : 'in';
  const base = `${args.title} — ${type} ${transaction} ${inWord} ${args.city}, ${args.countryDisplay}`;
  if (args.position && args.total && args.total > 1) {
    const photoLabel = cl === 'es' ? 'Foto' : 'Photo';
    const ofWord = cl === 'es' ? 'de' : 'of';
    return `${base} (${photoLabel} ${args.position} ${ofWord} ${args.total})`;
  }
  return base;
}

/**
 * Build the visible caption ("leyenda"). Same content as the alt text but
 * sentence-cased and without the photo-N-of-M suffix (the visible
 * caption appears once on the primary; the suffix would be visual noise).
 */
export function buildPhotoCaption(args: Omit<PhotoSeoArgs, 'position' | 'total'>): string {
  const cl = narrowContentLocale(args.locale);
  const transaction = TRANSACTION_PHRASE[cl][args.transactionType];
  const type = propertyTypeLabel(args.propertyType, args.locale);
  const inWord = cl === 'es' ? 'en' : 'in';
  return `${args.title} — ${capitalizeFirst(type)} ${transaction} ${inWord} ${args.city}, ${args.countryDisplay}`;
}
