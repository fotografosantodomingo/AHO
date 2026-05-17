import 'server-only';
import type { Locale } from '@/i18n/config';

/**
 * Per-market system prompts — Phase 5 of
 * `docs/SUPER_PRO_STAGE_1_PLAN.md` (Multilingual Context Engine).
 *
 * Before this module, `ai-drafter.ts` had a single global SYSTEM_PROMPT
 * that hard-coded the rule "Write in 'en' or 'es' only." Marketing
 * locales (pl/pt/de/fr/it) were narrowed down to 'en' by
 * `narrowContentLocale`, so a Polish agent paying for a Polish-language
 * audit was silently getting English drafts. Total trust-killer the
 * moment they looked at the preview.
 *
 * This file replaces that with PER-MARKET system prompts that bake in:
 *   - The actual target language (PL drafts in Polish, DE in German, …)
 *   - Local real-estate jargon (DE: Wohnfläche, Energiebedarf; PL:
 *     stan deweloperski, RTV/AGD; IT: trilocale; …)
 *   - Locale-appropriate emotional tone (US lifestyle aspirational vs.
 *     DE technical precision vs. IT cinematic emotion)
 *   - Locale-appropriate closing CTAs ("Schedule a tour" vs.
 *     "Besichtigung vereinbaren" vs. "Prenota visita")
 *   - The right "Link in bio" phrase per Instagram convention in each
 *     market (some platforms localize, some don't — captured here)
 *
 * Backward compatible: callers that don't pass a `market` get the
 * locale-derived market via `localeToMarket()`, which produces sensible
 * defaults for the existing en/es-only callers.
 *
 * Per the plan's Phase 5 acceptance bar: "DE preview reads German,
 * not translated English." That bar passes when the model writes the
 * caption ENTIRELY in the target language — the prompt enforces this
 * as a CRITICAL LANGUAGE RULE rather than a polite suggestion.
 */

export type Market = 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

export const SUPPORTED_MARKETS: readonly Market[] = [
  'us',
  'es',
  'pl',
  'pt',
  'de',
  'fr',
  'it',
] as const;

const LOCALE_TO_MARKET: Record<Locale, Market> = {
  en: 'us',
  es: 'es',
  pl: 'pl',
  pt: 'pt',
  de: 'de',
  fr: 'fr',
  it: 'it',
};

export function localeToMarket(locale: Locale): Market {
  return LOCALE_TO_MARKET[locale] ?? 'us';
}

interface MarketSpec {
  language: string;
  tone: string;
  jargon: string[];
  closingCta: string[];
  hashtagsExample: string[];
  linkInBio: string;
  fullDetails: string;
}

const MARKET_SPECS: Record<Market, MarketSpec> = {
  us: {
    language: 'English (US)',
    tone:
      'Lifestyle dream, aspirational. Specific evocative language about the SPACE (light, layout, neighborhood feel) — never invented features.',
    jargon: ['sqft', 'HOA', 'closing costs', 'turnkey', 'open-concept'],
    closingCta: ['Schedule a tour', 'Book a private showing', 'See it in person'],
    hashtagsExample: ['#realestate', '#dreamhome', '#newlisting'],
    linkInBio: 'Link in bio',
    fullDetails: 'Full details and photos:',
  },
  es: {
    language: 'Spanish (Spain + LATAM-compatible)',
    tone:
      'Estilo + ubicación. Cálido y descriptivo, vocabulario inmobiliario español. Evitar superlativos absolutos.',
    jargon: [
      'metros cuadrados',
      'urbanización',
      'estado',
      'reformado',
      'a estrenar',
    ],
    closingCta: ['Reservar visita', 'Concertar visita', 'Más información'],
    hashtagsExample: ['#inmobiliaria', '#vivienda', '#piso'],
    linkInBio: 'Enlace en bio',
    fullDetails: 'Detalles completos y fotos:',
  },
  pl: {
    language: 'Polish',
    tone:
      'Praktyczność + lokalizacja. Konkretny, rzeczowy ton; polskie słownictwo nieruchomości. Bez przesadnych superlatywów.',
    jargon: [
      'metraż',
      'stan deweloperski',
      'rynek wtórny',
      'RTV/AGD',
      'wykończenie pod klucz',
    ],
    closingCta: ['Umów oglądanie', 'Skontaktuj się', 'Więcej zdjęć'],
    hashtagsExample: ['#nieruchomości', '#mieszkanie', '#nasprzedaż'],
    linkInBio: 'Link w bio',
    fullDetails: 'Pełne szczegóły i zdjęcia:',
  },
  pt: {
    language: 'Portuguese (Brazil-leaning, PT-compatible)',
    tone:
      'Aspiracional + familiar. Vocabulário brasileiro de imobiliária; também legível para o mercado PT.',
    jargon: ['m²', 'condomínio', 'vista', 'área de lazer', 'pronto para morar'],
    closingCta: ['Marcar visita', 'Agendar visita', 'Saiba mais'],
    hashtagsExample: ['#imovel', '#imoveisavenda', '#novoimovel'],
    linkInBio: 'Link na bio',
    fullDetails: 'Detalhes completos e fotos:',
  },
  de: {
    language: 'German',
    tone:
      'Technische Präzision + Quadratmeter-Fokus. Sachlich, ohne Übertreibung — deutsche Käufer:innen erwarten Fakten, keine Lifestyle-Phrasen.',
    jargon: [
      'Wohnfläche',
      'Energiebedarf',
      'Baujahr',
      'Erstbezug',
      'Süd-Balkon',
      'Provision',
    ],
    closingCta: [
      'Besichtigung vereinbaren',
      'Termin vereinbaren',
      'Mehr Informationen',
    ],
    hashtagsExample: ['#immobilien', '#wohnung', '#zumverkauf'],
    linkInBio: 'Link in Bio',
    fullDetails: 'Vollständige Details und Fotos:',
  },
  fr: {
    language: 'French',
    tone:
      'Style + emplacement. Ton chaleureux, vocabulaire immobilier français. Pas de superlatifs absolus.',
    jargon: ['m²', 'pièces', 'lumineux', 'standing', 'centre-ville', 'charme'],
    closingCta: ['Réserver une visite', 'Organiser une visite', "Plus d'infos"],
    hashtagsExample: ['#immobilier', '#appartement', '#avendre'],
    linkInBio: 'Lien en bio',
    fullDetails: 'Détails complets et photos :',
  },
  it: {
    language: 'Italian',
    tone:
      'Vista + emozione. Stile descrittivo e caldo, vocabolario immobiliare italiano. Niente superlativi assoluti.',
    jargon: ['trilocale', 'mq', 'rifinito', 'panoramico', 'centro storico'],
    closingCta: ['Prenota visita', 'Fissa un appuntamento', 'Maggiori info'],
    hashtagsExample: ['#immobiliare', '#casainvendita', '#realestate'],
    linkInBio: 'Link in bio',
    fullDetails: 'Dettagli completi e foto:',
  },
};

/**
 * Build the per-market system prompt that ai-drafter.ts will send to
 * Claude. The hard "CRITICAL LANGUAGE RULE" header is intentional — the
 * model is more likely to honor "write EVERY word in {language}" than a
 * polite "please write in {language}" suggestion at the end of a long
 * prompt. Treat the language rule as the single most important
 * constraint and the rest as decoration.
 */
export function buildSystemPrompt(market: Market): string {
  const spec = MARKET_SPECS[market];
  return `You are AHO's listing copy assistant. AHO is a real estate marketplace at advertisehomes.online. You write social-media drafts that licensed agents review and edit before posting. You never publish directly.

CRITICAL LANGUAGE RULE — non-negotiable:
- Write EVERY word of EVERY caption in ${spec.language}. NEVER in English (unless the target language IS English). NEVER mix languages. CTAs, hashtags except canonical brand tags, headings — all in ${spec.language}.
- If you cannot find a natural ${spec.language} equivalent for a fact, prefer omission over English.

MARKET TONE (${market.toUpperCase()}):
${spec.tone}

LOCAL JARGON — these are correct + expected in this market; use when relevant facts apply:
${spec.jargon.map((j) => `  - ${j}`).join('\n')}

CLOSING CTAs — pick one of these for FB / LinkedIn (don't use them on IG; IG performs worse with CTAs):
${spec.closingCta.map((c) => `  - ${c}`).join('\n')}

HARD RULES — non-negotiable:
- Use ONLY facts in the listing JSON. Do not invent amenities, views, schools, walkability, neighborhood character, HOA fees, taxes, year built. If a field is null, omit it from the post.
- Do not use absolute superlatives ("luxury", "stunning", "must-see", "won't last", "a steal", "below market" or local equivalents). Agents are licensed and superlatives carry liability.
- Output STRICT JSON matching the tool schema. No prose outside it.

PER-PLATFORM SHAPES:
- facebook.message: 2-3 short paragraphs, ~280-500 chars. Conversational third-person. End with "${spec.fullDetails}" then the URL on its own line. 1-2 hashtags max at the end (examples: ${spec.hashtagsExample.slice(0, 2).join(', ')}).
- instagram.caption: punchy 1st line. Blank line. 2-3 evocative lines about location/space — only what the listing JSON supports. Blank line. "${spec.linkInBio}" then the URL on its own line. Blank line. 8-12 hashtags ending with #aho and a city hashtag derived from the listing city.
- linkedin.commentary: 1 paragraph ~300-450 chars. Professional. End with "${spec.fullDetails}" and the URL. 1-2 tags like ${spec.hashtagsExample[0]}.
- linkedin.contentTitle: max 200 chars, the listing title trimmed if needed.
- linkedin.contentDescription: max 256 chars, compact line: "{city}, {country} · {price} · {specs}".

If a platform is not in the user's "platforms" list, omit that key from the output.`;
}

/** Exposed for unit tests + admin /tools that want to render a market
 *  preview without going through the network. */
export function _marketSpec(market: Market): MarketSpec {
  return MARKET_SPECS[market];
}
