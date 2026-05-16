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

/** Maximum number of images allowed in a single Instagram Business
 *  carousel per Meta's content-publishing API. Used by post-formatter +
 *  publish.ts; the route clamps before passing through. */
export const IG_CAROUSEL_MAX = 10;

/** Input shape — what every formatter takes. */
export interface PostInput {
  /** Listing title in the listing's authored language. */
  title: string;
  /** Full listing description in the active content locale (EN or ES).
   *  Pass the AGENT'S written description verbatim — no auto-summary,
   *  no clamp at the caller. The formatter is responsible for fitting
   *  within per-platform body caps. Optional because some legacy
   *  listings have null/empty descriptions; the formatter omits the
   *  block cleanly in that case. */
  description?: string | null;
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
  /** Property image URLs ordered by `position` (primary first). FB +
   *  LinkedIn use index 0 as their hero. IG uses the whole array —
   *  one photo = standard publish, 2-10 photos = carousel. Required
   *  for IG (any length ≥1); optional for FB + LinkedIn. */
  imageUrls?: string[];
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
  /** REQUIRED — IG won't publish without media. Length 1 → single-image
   *  2-step publish. Length 2-10 → carousel 3-step publish. Caller is
   *  responsible for clamping to IG_CAROUSEL_MAX. */
  imageUrls: string[];
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
  // Description goes in verbatim — PO directive 2026-05-16: agents want
  // the FULL listing copy in the FB post, not a 1-line auto-summary.
  // Empty/null description → omit the block entirely (no awkward blank
  // paragraph). The FB_MAX_CHARS clamp at the bottom catches the rare
  // case where title + 4000-char description blows the cap.
  const description = input.description?.trim() ?? '';
  const descBlock = description ? [description, ''] : [];
  const viewLabel = contentLocale === 'es' ? '👉 Ver en AHO:' : '👉 View on AHO:';

  const lines = contentLocale === 'es'
    ? [
        input.title,
        '',
        ...descBlock,
        `📍 ${input.city}, ${input.countryDisplay}`,
        `💰 ${price}`,
        ...(specs ? [specs] : []),
        '',
        viewLabel,
        link,
        '',
        `#inmuebles #aho${tag ? ` #${tag}` : ''}`,
      ]
    : [
        input.title,
        '',
        ...descBlock,
        `📍 ${input.city}, ${input.countryDisplay}`,
        `💰 ${price}`,
        ...(specs ? [specs] : []),
        '',
        viewLabel,
        link,
        '',
        `#realestate #aho${tag ? ` #${tag}` : ''}`,
      ];

  // FB uses the hero image only (no FB carousel via Graph API today).
  const heroImage = input.imageUrls?.[0];
  return {
    message: clamp(lines.join('\n'), FB_MAX_CHARS),
    link,
    ...(heroImage ? { imageUrl: heroImage } : {}),
  };
}

export function formatInstagramPost(input: PostInput): InstagramPost {
  const validImageUrls =
    input.imageUrls?.filter((u) => typeof u === 'string' && u.length > 0) ?? [];
  if (validImageUrls.length === 0) throw new MissingImageError('Instagram');
  // Defense-in-depth: clamp to the IG carousel limit even if caller
  // forgot. Source-of-truth clamp happens in the route layer.
  const imageUrls = validImageUrls.slice(0, IG_CAROUSEL_MAX);

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
    imageUrls,
  };
}

// ============================================================
// Override-aware pickers (Phase J — pre-share editor)
// ============================================================
//
// When the agent has used the AI drafter and edited the suggested
// captions, the publish route passes per-platform `overrides` to the
// picker functions below. The picker replaces the platform's *prose*
// with the agent's text but keeps the deterministic plumbing
// (UTM-tagged link, hero imageUrl, LinkedIn contentTitle +
// contentDescription) intact. This split is deliberate: agents control
// what they say; the system controls how the listing is identified.

/** Build a FacebookPost from either the agent's edited message or the
 *  deterministic formatter output. UTM-tagged link is always
 *  formatter-derived. */
export function pickFacebookPost(
  input: PostInput,
  override?: { message: string },
): FacebookPost {
  if (override) {
    const heroImage = input.imageUrls?.[0];
    return {
      message: override.message,
      link: withUtm(input.url, 'facebook'),
      ...(heroImage ? { imageUrl: heroImage } : {}),
    };
  }
  return formatFacebookPost(input);
}

/** Build an InstagramPost from either the agent's edited caption or
 *  the deterministic formatter output. IG hard-requires at least one
 *  imageUrl; overriding does not bypass that. */
export function pickInstagramPost(
  input: PostInput,
  override?: { caption: string },
): InstagramPost {
  const validImageUrls =
    input.imageUrls?.filter((u) => typeof u === 'string' && u.length > 0) ?? [];
  if (validImageUrls.length === 0) throw new MissingImageError('Instagram');
  if (override) {
    return {
      caption: override.caption,
      imageUrls: validImageUrls.slice(0, IG_CAROUSEL_MAX),
    };
  }
  return formatInstagramPost(input);
}

/** Build a LinkedInPost — only `commentary` is agent-controllable;
 *  contentUrl, contentTitle, contentDescription, contentThumbnailUrl
 *  stay deterministic (the article card is platform-identity, not voice). */
export function pickLinkedInPost(
  input: PostInput,
  override?: { commentary: string },
): LinkedInPost {
  const fromFormatter = formatLinkedInPost(input);
  if (!override) return fromFormatter;
  return {
    ...fromFormatter,
    commentary: clamp(override.commentary, LINKEDIN_MAX_CHARS),
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

  // LinkedIn article card thumbnail is the hero image only.
  const heroImage = input.imageUrls?.[0];
  return {
    commentary: clamp(commentaryLines.join('\n'), LINKEDIN_MAX_CHARS),
    contentUrl: link,
    contentTitle: clamp(input.title, LINKEDIN_TITLE_MAX),
    contentDescription: clamp(description, LINKEDIN_DESCRIPTION_MAX),
    ...(heroImage ? { contentThumbnailUrl: heroImage } : {}),
  };
}
