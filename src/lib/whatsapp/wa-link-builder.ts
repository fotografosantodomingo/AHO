/**
 * wa.me URL builder.
 *
 * Phase 4 of docs/AI_AGENT_PLAN.md. Pure function — no env, no DB,
 * no network. Mirrors the style of src/lib/listings/photo-seo.ts.
 *
 * Produces the `https://wa.me/<phone>?text=<pre-filled>` URL we
 * render on listing pages + agent profiles. The pre-filled message
 * embeds a parseable listing-context hint so the inbound webhook
 * (workers/whatsapp-webhook + /api/inbound/whatsapp) can resolve
 * the conversation to the right listing — without that hint, the
 * AI has no way to know which property the buyer is asking about.
 *
 * Listing-context hint format: `AHO-<short_id>` appended to the
 * locale-aware pre-fill message. The short_id is the same identifier
 * we render in property URL slugs (see src/lib/listings/seo.ts:
 * `slugify(title)-<short_id>`); the inbound parser uses the regex
 * exported below (`AHO_LISTING_HINT_REGEX`) to extract it.
 *
 * Locale awareness: each of the 7 AHO marketing locales gets a
 * hand-translated pre-fill. The buyer's locale (NOT the agent's
 * locale) drives the choice — buyer reads "Hi! I'm interested in"
 * in their own language.
 *
 * Phone format: wa.me REQUIRES the international phone number
 * WITHOUT the leading '+' or any spaces / dashes. We accept E.164
 * with the '+' and normalize.
 */

import type { Locale } from '@/i18n/config';

export interface BuildWaMeUrlArgs {
  /** Agent's WhatsApp number in E.164 (with or without leading '+'). */
  phone_e164: string;
  /** Optional listing short id. Encoded as `AHO-<short_id>` in the
   *  pre-fill so the inbound parser can pick it up. */
  listing_short_id?: string | null;
  /** Buyer's UI locale. Drives the pre-fill language. */
  locale: Locale;
}

/**
 * Locale-aware pre-fill template. The `{listing}` token is replaced
 * with `(listing AHO-<short_id>)` when a short id is supplied;
 * otherwise the token + surrounding space collapses to empty.
 *
 * Translation principle (PO directive 2026-04-29 — HashiCorp visual
 * design): keep the pre-fill short, friendly, and unambiguously
 * buyer-side. The AHO suffix doubles as a routing marker AND as a
 * subtle branding signal that the conversation originated on AHO.
 */
const PREFILL_TEMPLATES: Record<Locale, string> = {
  en: "Hi! I'm interested {listing}.",
  es: 'Hola, me interesa {listing}.',
  pl: 'Cześć! Interesuje mnie {listing}.',
  pt: 'Olá! Tenho interesse {listing}.',
  de: 'Hallo! Ich interessiere mich {listing}.',
  fr: 'Bonjour, je suis intéressé(e) {listing}.',
  it: 'Salve! Sono interessato/a {listing}.',
};

/**
 * Locale-aware "listing AHO-XXXX" phrase. Kept separate from the
 * top-level template so we can collapse the {listing} token cleanly
 * when no short_id is supplied (general-inquiry click).
 */
const LISTING_PHRASES: Record<Locale, (shortId: string) => string> = {
  en: (id) => `in listing AHO-${id}`,
  es: (id) => `en el inmueble AHO-${id}`,
  pl: (id) => `ofertą AHO-${id}`,
  pt: (id) => `no imóvel AHO-${id}`,
  de: (id) => `für das Inserat AHO-${id}`,
  fr: (id) => `par l'annonce AHO-${id}`,
  it: (id) => `all'annuncio AHO-${id}`,
};

/**
 * Regex the inbound parser uses to extract the listing short id from
 * the buyer's first message. Case-insensitive; matches both the
 * canonical `AHO-<short_id>` form and the lowercase form some mobile
 * keyboards auto-correct to.
 *
 * Capture group 1 = the short id.
 *
 * Exported so /api/inbound/whatsapp can reuse it; Phase 4 polish PR
 * will inject the parse step into the conversation router.
 */
export const AHO_LISTING_HINT_REGEX = /AHO-([A-Za-z0-9]{4,16})/i;

/**
 * Build a `https://wa.me/<phone>?text=<msg>` URL.
 *
 * Returns the URL as a string. The `text` query parameter is fully
 * URL-encoded via `URLSearchParams` (which encodes spaces as `+`,
 * which wa.me accepts).
 */
export function buildWaMeUrl(args: BuildWaMeUrlArgs): string {
  const phone = normalizePhoneForWaMe(args.phone_e164);
  const text = buildWaPrefillText({
    listing_short_id: args.listing_short_id ?? null,
    locale: args.locale,
  });
  const params = new URLSearchParams({ text });
  return `https://wa.me/${phone}?${params.toString()}`;
}

/**
 * Build just the pre-fill text (no URL wrapping). Exposed so the
 * inbound parser can compare against the canonical form and so
 * tests can exercise the locale matrix without URL-decoding.
 */
export function buildWaPrefillText(args: {
  listing_short_id: string | null;
  locale: Locale;
}): string {
  const template = PREFILL_TEMPLATES[args.locale] ?? PREFILL_TEMPLATES.en;
  if (args.listing_short_id) {
    const phrase = (LISTING_PHRASES[args.locale] ?? LISTING_PHRASES.en)(
      args.listing_short_id,
    );
    return template.replace('{listing}', phrase);
  }
  // Collapse "{listing}" + a single surrounding space cleanly.
  return template
    .replace(' {listing}', '')
    .replace('{listing}', '');
}

/**
 * Extract an AHO listing short_id from inbound text. Returns null
 * if no hint is found. Used by the inbound conversation router.
 */
export function parseWaListingHint(text: string): string | null {
  const match = AHO_LISTING_HINT_REGEX.exec(text);
  if (!match) return null;
  return match[1] ?? null;
}

/**
 * wa.me requires the phone in international format with NO leading
 * '+' and NO non-digit characters. We accept E.164 inputs with or
 * without the '+' for caller convenience.
 */
function normalizePhoneForWaMe(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}
