// Direct fetch to the Anthropic Messages API instead of the official
// `@anthropic-ai/sdk` package. The SDK pulls `node:fs` + `node:path`
// internally, which webpack can't bundle for Cloudflare Pages' Edge
// runtime ("UnhandledSchemeError: Reading from 'node:fs' is not
// handled by plugins"). The Messages endpoint is plain JSON-over-HTTPS
// — fetch is more than enough.
//
// `server-only` deliberately omitted so the helper is callable from
// scripts/ (e.g. test-copywriter.ts) without webpack-vs-tsx friction.
// All call sites read ANTHROPIC_API_KEY from process.env, which is
// `undefined` on the client — the function throws fast, no secret
// leak. The compiler-only `server-only` gate isn't load-bearing here.
import type { Locale } from '@/i18n/config';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Real-estate ad copywriter — Anthropic Claude Sonnet 4.6.
 *
 * Per `aho_strategic_vision.md`: this is the engine behind the
 * "paste-link → ready campaign" hook. The Sprint-1 contract is:
 * given a property's facts + a target locale + a target social
 * platform, return N variant captions tuned for that combo.
 *
 * Prompt strategy: ONE system prompt that codifies real-estate
 * marketing voice + per-locale emotional register + per-platform
 * length / tone constraints. Output forced to JSON via Anthropic's
 * structured-output prompt convention (we explicitly demand a JSON
 * array; the model returns text starting with `[`; we parse).
 *
 * Per-locale "emotional register" comes from the strategic-vision
 * memory: US→lifestyle, PL→praktyczność + lokalizacja, IT→emozione
 * etc. Captions in each locale read like a native marketer wrote
 * them, not like a translation of the EN version.
 */

export const COPYWRITER_PLATFORMS = [
  'fb_feed',
  'ig_feed',
  'ig_reel',
  'linkedin',
] as const;
export type CopywriterPlatform = (typeof COPYWRITER_PLATFORMS)[number];

export interface PropertyFacts {
  title: string;
  transactionType: 'sale' | 'rent' | 'short_term';
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  city: string;
  countryDisplay: string;
  /** Localized formatted price string, e.g. "$350,000" or "€350.000". */
  priceLabel: string;
  amenities: string[];
  /** Listing description in the target locale (or EN fallback). Trimmed
   *  to ~600 chars to keep prompt size bounded. */
  description: string | null;
  /** Optional buyer profile or distinctive feature the agent flagged
   *  (e.g., "perfect for remote-working couples", "investor opportunity"). */
  positioningHint?: string | null;
}

export interface GeneratedCaption {
  text: string;
  characterCount: number;
  hashtags: string[];
}

export interface CopywriterResult {
  captions: GeneratedCaption[];
  /** Anthropic model identifier we used. */
  model: string;
  /** Approximate input + output tokens — for cost monitoring. */
  inputTokens: number;
  outputTokens: number;
}

interface CallArgs {
  facts: PropertyFacts;
  locale: Locale;
  platform: CopywriterPlatform;
  count?: number;
}

const PLATFORM_CONSTRAINTS: Record<
  CopywriterPlatform,
  { lengthRange: string; hashtagsRange: string; tone: string }
> = {
  fb_feed: {
    lengthRange: '80-180 characters',
    hashtagsRange: '0-2 hashtags (use sparingly; FB downranks hashtag-spam)',
    tone: 'conversational, single hook + benefit + soft call to action',
  },
  ig_feed: {
    lengthRange: '120-220 characters',
    hashtagsRange: '5-8 hashtags at the END (mix of broad + niche + city)',
    tone: 'visual-first; assume the photo carries the impact, caption adds context + emotional pull',
  },
  ig_reel: {
    lengthRange: '60-120 characters (people read 1-2 seconds)',
    hashtagsRange: '8-12 hashtags at the END',
    tone: 'punchy; one hook line + curiosity gap; assume video already shows the property',
  },
  linkedin: {
    lengthRange: '250-450 characters',
    hashtagsRange: '2-4 hashtags',
    tone: 'professional; investor angle when it fits; emphasize location, ROI signals, and market positioning',
  },
};

/** Per-locale voice guide. Codifies the strategic-vision rule that
 *  each language needs its own emotional register, not a translation
 *  of EN. Phrases here are passed verbatim into the prompt; reading
 *  them in isolation should give the model a clear cultural
 *  positioning per market. */
const LOCALE_VOICE: Record<Locale, string> = {
  en: 'American English — lifestyle-first ("imagine waking up to…"), benefit-focused, conversational, optimistic. Avoid corporate jargon. The reader is dreaming, not analyzing.',
  es: 'Español neutral con calidez familiar (LATAM blend, leans Caribbean for AHO\'s DR launch market). Lifestyle + family + ubicación. Avoid Spain-only idioms ("tío", "guay"). Use "tu" not "vos". Slight emotional appeal, never cheesy.',
  pl: 'Polski — praktyczny, konkretny, lokalizacja-first. Polacy kupują nieruchomość rozumem: metraż, lokalizacja, dojazd, plan. Skip dramatic lifestyle hooks; lead with substance. Krótko, na temat. Emocje subtelne ("idealne dla rodziny" zamiast "spełnij swoje marzenia").',
  pt: 'Português — equilibrado entre PT-BR e PT-PT (default to PT-BR phrasing for the larger market). Lifestyle + localização + valor. Tom familiar, caloroso, sem ser cafona. Avoid English loanwords when a clean PT word exists.',
  de: 'Deutsch — sachlich, präzise, technische Details first (Wohnfläche, Lage, Baujahr, Energieeffizienz). German buyers respect specs over sales-pitch. Höflich, professionell. Avoid emotional adjectives stacked together. Single clear claim per sentence.',
  fr: 'Français — élégance + art de vivre. Localisation prestigieuse quand pertinent. Phrases fluides, pas trop courtes. Ton professionnel mais chaleureux. Avoid franglais. The reader appreciates style and craftsmanship.',
  it: 'Italiano — emozione + bellezza + famiglia. Italians buy with the heart, especially for casa di famiglia. Calore umano, lifestyle ("la tua nuova vita"). Toni informali ma non gergali. Highlight terrazzo / vista / centro storico if applicable.',
};

/**
 * Build the system prompt. Combines: master role description +
 * per-platform constraints + per-locale voice guide + output format
 * rule (strict JSON).
 */
function buildSystemPrompt(args: { locale: Locale; platform: CopywriterPlatform }): string {
  const platform = PLATFORM_CONSTRAINTS[args.platform];
  const voice = LOCALE_VOICE[args.locale];
  return [
    `You are a senior real-estate marketing copywriter writing in ${args.locale.toUpperCase()}. You write social-media captions for property listings that read like a native local marketer wrote them — never like a translation.`,
    '',
    `Locale voice: ${voice}`,
    '',
    `Platform: ${args.platform}`,
    `Length: ${platform.lengthRange}`,
    `Tone: ${platform.tone}`,
    `Hashtags: ${platform.hashtagsRange}`,
    '',
    `Output rules:`,
    `1. Respond with ONLY a JSON array. No prose outside the array. No code-fence markers.`,
    `2. Each element: {"text": "<caption body without hashtags>", "hashtags": ["#tag1", "#tag2"]}`,
    `3. Keep "text" within the platform length range. Hashtags go in the separate field, not embedded in text.`,
    `4. Each variant must be DISTINCT in angle, not just rephrased. Variant A leans on lifestyle, Variant B on facts, Variant C on location, etc.`,
    `5. Never invent facts. If a field is null/missing in the input, omit it — don't guess.`,
    `6. Never include emojis at the start of every caption — feels mass-produced. Sprinkle one or two at most, where it adds flavor.`,
    `7. Avoid "Don't miss out!" / "Limited time!" / fake-urgency phrases. Real-estate buyers can spot them.`,
  ].join('\n');
}

function buildUserPrompt(args: CallArgs): string {
  const f = args.facts;
  const lines = [
    `Generate ${args.count ?? 3} caption variants for this listing.`,
    '',
    `Title: ${f.title}`,
    `Transaction: ${f.transactionType === 'sale' ? 'For sale' : f.transactionType === 'rent' ? 'For rent' : 'Short-term rental'}`,
    `Property type: ${f.propertyType}`,
    f.bedrooms != null ? `Bedrooms: ${f.bedrooms}` : null,
    f.bathrooms != null ? `Bathrooms: ${f.bathrooms}` : null,
    f.areaSqm != null ? `Area: ${f.areaSqm} m²` : null,
    `Location: ${f.city}, ${f.countryDisplay}`,
    `Price: ${f.priceLabel}`,
    f.amenities.length > 0 ? `Amenities: ${f.amenities.join(', ')}` : null,
    f.positioningHint ? `Agent note (positioning): ${f.positioningHint}` : null,
    f.description ? `Listing description: ${f.description.slice(0, 600)}` : null,
  ].filter((s): s is string => s !== null);
  return lines.join('\n');
}

/** Sonnet 4.6 — fast + strong creative writing for ad copy.
 *  Switch to opus-4-7 if quality needs uplift; switch to haiku-4-5
 *  if cost matters more than craft. */
const MODEL_ID = 'claude-sonnet-4-6';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicResponseBlock {
  type: string;
  text?: string;
}
interface AnthropicResponse {
  content: AnthropicResponseBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason?: string;
  model?: string;
}

/**
 * Generate caption variants. Throws on API error or unparseable
 * response — caller wraps in try/catch.
 */
export async function generateCaptions(args: CallArgs): Promise<CopywriterResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  const count = args.count ?? 3;

  const apiRes = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: 1500,
      system: buildSystemPrompt({ locale: args.locale, platform: args.platform }),
      messages: [{ role: 'user', content: buildUserPrompt({ ...args, count }) }],
    }),
  });

  if (!apiRes.ok) {
    const detail = await apiRes.text();
    throw new Error(`Anthropic API ${apiRes.status}: ${detail.slice(0, 400)}`);
  }

  const response = (await apiRes.json()) as AnthropicResponse;

  // Concatenate text blocks. Anthropic's content array includes
  // text + thinking + tool_use blocks; we only consume text here.
  const text = response.content
    .filter((b): b is AnthropicTextBlock => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');

  // Strip any accidental code-fence wrapping.
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: Array<{ text: string; hashtags?: string[] }>;
  try {
    parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error('not an array');
  } catch (e) {
    throw new Error(
      `Copywriter response wasn't valid JSON: ${e instanceof Error ? e.message : e}. Got: ${trimmed.slice(0, 200)}`,
    );
  }

  const captions: GeneratedCaption[] = parsed.map((p) => ({
    text: String(p.text ?? '').trim(),
    characterCount: String(p.text ?? '').trim().length,
    hashtags: Array.isArray(p.hashtags)
      ? p.hashtags.map((h) => String(h)).filter((h) => h.length > 0)
      : [],
  }));

  return {
    captions,
    model: MODEL_ID,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
