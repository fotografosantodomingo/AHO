/**
 * Post formatter — pure (property, locale) → platform-specific text + media.
 *
 * Phase C of docs/SOCIAL_AUTOMATION_PLAN.md. Pure functions: same input →
 * same output, no DB / no fetch / no env reads. Edge-safe.
 *
 * Per the skill `social-platform-integration` step #5: "Implement the post
 * formatter — a pure function from (property, social_account, language)
 * to rendered text + media references. Add unit tests for known edge cases."
 *
 * Locale handling: posts use AHO's two content locales (EN + ES). Listings
 * are authored in EN or ES (the 5 marketing locales fall back to EN content
 * per the i18n config), so post copy follows the same narrowing —
 * `narrowContentLocale()` at the input boundary. A listing in Spanish-DR
 * generates Spanish posts; everything else generates English posts. When/if
 * we add per-locale post templates for PL/PT/DE/FR/IT, this is the single
 * place to extend.
 *
 * Per-platform character caps are *soft* (we trim with an ellipsis below the
 * platform's hard ceiling so we never bounce off a 4xx for length alone):
 *   - Facebook feed message:    4000 chars  (platform ceiling ~63k, ample headroom)
 *   - Instagram caption:        2000 chars  (platform ceiling 2200)
 *   - LinkedIn commentary:      2800 chars  (platform ceiling 3000)
 *
 * Instagram is the only platform that *requires* an image — `formatInstagramPost`
 * throws `MissingImageError` when `imageUrl` is absent. FB + LinkedIn happily
 * publish text-only posts with link previews; we just attach the image when
 * available for richer cards.
 */

import { formatPrice } from '@/lib/listings/format';
import { narrowContentLocale, type Locale } from '@/i18n/config';

const FB_MAX_CHARS = 4000;
const IG_MAX_CHARS = 2000;
const LINKEDIN_MAX_CHARS = 2800;
const LINKEDIN_TITLE_MAX = 200;
const LINKEDIN_DESCRIPTION_MAX = 256;

/** Input shape — what every formatter takes. */
export interface PostInput {
  /** Listing title in the listing's authored language. */
  title: string;
  city: string;
  /** Country display name in the active locale (e.g. "Dominican Republic" / "República Dominicana"). */
  countryDisplay: string;
  priceCents: number;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  /** Absolute URL to the public listing page (without UTM params).
   *  Formatters append per-platform `utm_source` for analytics. */
  url: string;
  /** Hero image URL (Cloudflare Images variant `og` or `card`). Required for IG. */
  imageUrl?: string;
  /** Listing locale — narrowed to EN/ES at the input boundary. */
  locale: Locale;
}

export interface FacebookPost {
  /** Body text. FB auto-renders the link preview from `link`. */
  message: string;
  /** Listing URL (UTM-tagged). FB consumes this for the preview card. */
  link: string;
  /** Optional hero image — when present the route handler hits `/photos`
   *  with `link` + `caption=message`; absent → `/feed` with `link`. */
  imageUrl?: string;
}

export interface InstagramPost {
  /** Body text — IG strips URLs from clickability, so we keep the URL
   *  in the caption for read-only reference + push agents to "link in bio". */
  caption: string;
  /** REQUIRED — IG won't publish without a media object. */
  imageUrl: string;
}

export interface LinkedInPost {
  /** Body prose. */
  commentary: string;
  /** Listing URL (UTM-tagged) — LinkedIn renders this as an article card. */
  contentUrl: string;
  contentTitle: string;
  contentDescription: string;
  /** Optional preview image — LinkedIn uses this for the article card thumbnail. */
  contentThumbnailUrl?: string;
}

/** Thrown by `formatInstagramPost` when no `imageUrl` is supplied. */
export class MissingImageError extends Error {
  constructor(platform: string) {
    super(`${platform} requires imageUrl but PostInput.imageUrl was not provided`);
    this.name = 'MissingImageError';
  }
}

// ============================================================
// Helpers (exported for testability)
// ============================================================

/** Build the "🛏 N · 🛁 N · 📐 N m²" line. Returns null when all three are null/zero. */
export function specsLine(input: Pick<PostInput, 'bedrooms' | 'bathrooms' | 'areaSqm'>): string | null {
  const parts: string[] = [];
  if (input.bedrooms != null && input.bedrooms > 0) parts.push(`🛏 ${input.bedrooms}`);
  if (input.bathrooms != null && input.bathrooms > 0) parts.push(`🛁 ${input.bathrooms}`);
  if (input.areaSqm != null && input.areaSqm > 0) parts.push(`📐 ${Math.round(input.areaSqm)} m²`);
  return parts.length ? parts.join(' · ') : null;
}

/** Strip diacritics + non-alphanumerics so "Łódź" → "lodz" works as a hashtag. */
export function cityHashtag(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Truncate `s` to at most `max` chars; if truncated, end with an ellipsis. */
export function clamp(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

/** Append `?utm_source=…&utm_medium=social&utm_campaign=agent_share` to the listing URL. */
export function withUtm(url: string, source: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}utm_source=${source}&utm_medium=social&utm_campaign=agent_share`;
}

// ============================================================
// Per-platform formatters
// ============================================================

export function formatFacebookPost(input: PostInput): FacebookPost {
  const contentLocale = narrowContentLocale(input.locale);
  const price = formatPrice(input.priceCents, input.currency, contentLocale);
  const specs = specsLine(input);
  const tag = cityHashtag(input.city);
  const link = withUtm(input.url, 'facebook');

  const lines = contentLocale === 'es'
    ? [
        input.title,
        '',
        `📍 ${input.city}, ${input.countryDisplay}`,
        `💰 ${price}`,
        ...(specs ? [specs] : []),
        '',
        `#inmuebles #aho${tag ? ` #${tag}` : ''}`,
      ]
    : [
        input.title,
        '',
        `📍 ${input.city}, ${input.countryDisplay}`,
        `💰 ${price}`,
        ...(specs ? [specs] : []),
        '',
        `#realestate #aho${tag ? ` #${tag}` : ''}`,
      ];

  return {
    message: clamp(lines.join('\n'), FB_MAX_CHARS),
    link,
    ...(input.imageUrl ? { imageUrl: input.imageUrl } : {}),
  };
}

export function formatInstagramPost(input: PostInput): InstagramPost {
  if (!input.imageUrl) throw new MissingImageError('Instagram');

  const contentLocale = narrowContentLocale(input.locale);
  const price = formatPrice(input.priceCents, input.currency, contentLocale);
  const specs = specsLine(input);
  const tag = cityHashtag(input.city);

  const lines = contentLocale === 'es'
    ? [
        `✨ ${input.title}`,
        '',
        `📍 ${input.city}, ${input.countryDisplay}`,
        `💰 ${price}`,
        ...(specs ? [specs] : []),
        '',
        'Enlace en bio:',
        input.url,
        '',
        `#inmuebles #aho #bienesraices${tag ? ` #${tag}` : ''} #propiedadesenventa`,
      ]
    : [
        `✨ ${input.title}`,
        '',
        `📍 ${input.city}, ${input.countryDisplay}`,
        `💰 ${price}`,
        ...(specs ? [specs] : []),
        '',
        'Link in bio:',
        input.url,
        '',
        `#realestate #aho #propertyforsale${tag ? ` #${tag}` : ''} #homesforsale`,
      ];

  return {
    caption: clamp(lines.join('\n'), IG_MAX_CHARS),
    imageUrl: input.imageUrl,
  };
}

export function formatLinkedInPost(input: PostInput): LinkedInPost {
  const contentLocale = narrowContentLocale(input.locale);
  const price = formatPrice(input.priceCents, input.currency, contentLocale);
  const specs = specsLine(input);
  const link = withUtm(input.url, 'linkedin');

  const commentaryLines = contentLocale === 'es'
    ? [
        `Nuevo en el mercado: ${input.title}`,
        '',
        `Ubicación: ${input.city}, ${input.countryDisplay}`,
        `Precio: ${price}`,
        ...(specs ? [`Detalles: ${specs}`] : []),
        '',
        `Más información: ${link}`,
        '',
        '#bienesraices #inmuebles #inversion',
      ]
    : [
        `New on the market: ${input.title}`,
        '',
        `Location: ${input.city}, ${input.countryDisplay}`,
        `Price: ${price}`,
        ...(specs ? [`Details: ${specs}`] : []),
        '',
        `Full details: ${link}`,
        '',
        '#realestate #property #investment',
      ];

  // Compact one-line description for the LinkedIn article card. Same in
  // both locales for now — the card body is small enough that translation
  // adds little value over the structured data.
  const description = `${input.city}, ${input.countryDisplay} · ${price}${specs ? ` · ${specs}` : ''}`;

  return {
    commentary: clamp(commentaryLines.join('\n'), LINKEDIN_MAX_CHARS),
    contentUrl: link,
    contentTitle: clamp(input.title, LINKEDIN_TITLE_MAX),
    contentDescription: clamp(description, LINKEDIN_DESCRIPTION_MAX),
    ...(input.imageUrl ? { contentThumbnailUrl: input.imageUrl } : {}),
  };
}
