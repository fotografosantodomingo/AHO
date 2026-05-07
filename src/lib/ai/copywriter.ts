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

/**
 * Tone of voice — the WHAT-to-talk-about axis. Per
 * `docs/CONTENT_HUB_VISION.md`, three tones cover the bulk of agent
 * positioning needs: Luxury (status / rarity), Investment (ROI / yield),
 * Family (community / safety). Investment is the v1 default and the
 * gold-standard quality bar; the other two are tuned to match.
 *
 * Layering rule: per-locale voice (LOCALE_VOICE) governs HOW the
 * caption sounds in the target language; tone governs WHAT angle the
 * caption leads with. PL+Investment is not the same caption as
 * EN+Investment — the locale voice still shapes word choice, sentence
 * rhythm, and emotional register.
 */
export const COPYWRITER_TONES = ['luxury', 'investment', 'family'] as const;
export type Tone = (typeof COPYWRITER_TONES)[number];

/** Default tone — keeps existing callers (and any cached client
 *  payloads in flight) producing the Investment-tone copy that shipped
 *  in Sprint 1 before the selector existed. */
export const DEFAULT_TONE: Tone = 'investment';

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
  /** Caption body — no URL, no hashtags. Sized to 70% of the
   *  platform's Read-more cutoff. */
  text: string;
  characterCount: number;
  hashtags: string[];
  /** Pre-assembled "agent copies this as-is" string: body + newline +
   *  listingUrl + newline + hashtags. When listingUrl is null (e.g.
   *  the standalone playground without a published listing), the URL
   *  line is omitted. The Copy button on the UI uses this verbatim. */
  readyToPaste: string;
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
  /** Tone of voice — luxury / investment / family. Defaults to
   *  `investment` to preserve back-compat with Sprint-1 callers (and
   *  any in-flight cached client payloads) that didn't pass tone. */
  tone?: Tone;
  /** Permanent AHO listing URL — embedded into every caption so each
   *  social post links back to advertisehomes.online. Required when
   *  generating for a published listing; pass null for the standalone
   *  playground / preview-before-publish flow. */
  listingUrl?: string | null;
}

/**
 * Per-platform "Read more" cutoff. Captions stay at 70% of this so:
 *   - Algorithms never truncate mid-sentence (PO directive 2026-05-07)
 *   - The post reads like a marketer chose to write that length, not
 *     like AI auto-filled to the max
 *   - Leaves headroom for the AHO URL on its own line + hashtag block
 *
 * `body70Pct` is the actual ceiling for the caption text itself,
 * exclusive of URL and hashtag lines (the URL becomes a link card
 * preview on FB/LinkedIn; on IG it's plain text but agents still
 * point users to "link in bio"; either way it doesn't compete with
 * the body for the visible-on-feed real estate).
 */
const PLATFORM_CONSTRAINTS: Record<
  CopywriterPlatform,
  {
    bodyMaxChars: number;
    hashtagsRange: string;
    tone: string;
  }
> = {
  fb_feed: {
    // FB feed cutoff ~180 chars before "See more". 70% = 126.
    bodyMaxChars: 126,
    hashtagsRange: '0-2 hashtags (use sparingly; FB downranks hashtag-spam)',
    tone: 'conversational, single hook + benefit + soft call to action',
  },
  ig_feed: {
    // IG feed shows ~125 chars in feed (rest behind "more"). 70% of 220
    // visible-once-expanded gives 154 — still readable when expanded.
    bodyMaxChars: 154,
    hashtagsRange: '5-8 hashtags at the END (mix of broad + niche + city)',
    tone: 'visual-first; assume the photo carries the impact, caption adds context + emotional pull',
  },
  ig_reel: {
    // Reels viewers read 1-2 seconds while scrolling. 70% of 120 = 84.
    bodyMaxChars: 84,
    hashtagsRange: '8-12 hashtags at the END',
    tone: 'punchy; one hook line + curiosity gap; assume video already shows the property',
  },
  linkedin: {
    // LinkedIn shows ~210 chars before "...more". 70% of 450 visible
    // = 315 — agent-LinkedIn buyers WILL expand for a property post.
    bodyMaxChars: 315,
    hashtagsRange: '2-4 hashtags',
    // Platform-level guidance kept tone-neutral so the selectable
    // Tone block (Luxury / Investment / Family) drives the angle.
    // Pre-tone-selector default ("investor-leaning, lead with ROI")
    // moved into the Investment-tone instructions where it belongs.
    tone: 'professional, longer-form. The reader expects substance and will expand to read. Treat them as a sophisticated decision-maker — informed, time-pressed, allergic to fluff.',
  },
};

/**
 * Per-tone voice guide. Each entry is a multi-line block injected
 * verbatim into the system prompt so the model has explicit guidance
 * on (1) what the lead angle is, (2) what vocabulary register to use,
 * (3) what to skip, and (4) how the three variants should differ from
 * each other — three distinct angles within the tone, not three
 * rephrasings of the same hook.
 *
 * Investment is the gold-standard quality bar (it shipped first and is
 * the v1 default); Luxury and Family are tuned to match its specificity.
 */
const TONE_VOICE: Record<Tone, { label: string; instructions: string }> = {
  luxury: {
    label: 'LUXURY',
    instructions: [
      'The reader is a discerning buyer drawn to rarity, craftsmanship, and lifestyle as a status signal — not someone running yield calculations. Lead with what makes the property hard to replicate: provenance, materials, address, view, scale, the moments it makes possible.',
      'Vocabulary: aspirational and evocative — "private", "rare", "considered", "crafted", "address", "vista". Skip "ROI", "yield", "appreciation", "investment-grade" — they cheapen luxury copy. No price-per-square-meter framing.',
      'Sensory and scenic where appropriate ("morning light across the terrace", "the silence of the second floor"), but stay restrained — luxury is suggested, never shouted. Avoid superlatives stacked together.',
      'Three variants must lead with different facets of the property\'s rarity: e.g. Variant A leads with the address / location pedigree, Variant B with materials and craftsmanship, Variant C with the lifestyle moment the home enables. Three distinct angles, not three rephrasings.',
    ].join(' '),
  },
  investment: {
    label: 'INVESTMENT',
    instructions: [
      'The reader is a buyer evaluating return on capital, not a dreamer scrolling for inspiration. Lead with ROI signals: rental yield, capital appreciation, neighborhood trajectory, comparable sales, tax advantages where relevant. Treat soft features (lifestyle, family, "you\'ll love it") as supporting evidence, never the lead.',
      'Vocabulary: numerate and grounded — yield percentages where data supports them, capital-growth signals tied to neighborhood fundamentals, rental-comparable references, tax angles (e.g. Act 60 in PR, foreign-buyer programs in DR). Never invent yield numbers; if the input has none, lean on location strength and comparable price points.',
      'Three variants must lead with different investor angles: e.g. Variant A with rental yield, Variant B with capital appreciation, Variant C with the neighborhood\'s investment trajectory or a tax/regulatory advantage. Three distinct investor angles, not three rewrites of the same hook.',
    ].join(' '),
  },
  family: {
    label: 'FAMILY',
    instructions: [
      'The reader is a parent (or about-to-be parent) thinking in terms of life inside the home. Lead with what daily life looks like here: the school down the street, the walk to the park, the room that becomes a nursery, the kitchen where Sunday lunch happens, the neighborhood\'s rhythm.',
      'Vocabulary: warm and concrete — "school", "park", "walk to", "room to grow", "quiet street", "weekends", "kids", "neighbours". Avoid ROI / yield / appreciation framing entirely. Avoid rarity / status framing. The home is the setting for a life, not a trophy and not an asset class.',
      'Anchor every claim in something verifiable from the facts: distance to school, number of bedrooms, presence of garden / garage, neighborhood character. Don\'t invent schools or amenities not in the facts.',
      'Three variants must lead with different facets of family life: e.g. Variant A with the school / walkability angle, Variant B with the room-to-grow angle (bedrooms, garden, layout), Variant C with the neighborhood / weekend-rhythm angle. Three distinct family angles.',
    ].join(' '),
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
 * Build the system prompt. Combines: master role + selected tone of
 * voice (Luxury / Investment / Family) + per-platform 70% character
 * ceiling + per-locale voice + output JSON shape.
 *
 * Layering: locale voice governs HOW (cadence, register, native-speaker
 * idiom in the target language); tone governs WHAT (which angle leads).
 * Same listing in PL+Investment and EN+Investment shares the angle;
 * the words and rhythm differ.
 */
function buildSystemPrompt(args: {
  locale: Locale;
  platform: CopywriterPlatform;
  tone: Tone;
}): string {
  const platform = PLATFORM_CONSTRAINTS[args.platform];
  const voice = LOCALE_VOICE[args.locale];
  const tone = TONE_VOICE[args.tone];
  // Generic "no fake urgency" phrasing — applies to all tones.
  // (Pre-selector copy was investor-specific; the current line works
  //  for luxury / family buyers too.)
  return [
    `You are a senior real-estate marketing copywriter writing in ${args.locale.toUpperCase()}. You write social-media captions for property listings that read like a native local marketer wrote them — never like a translation.`,
    '',
    `Tone of voice: ${tone.label}. ${tone.instructions}`,
    '',
    `Locale voice (governs HOW you say it; tone above governs WHAT angle you lead with): ${voice}`,
    '',
    `Platform: ${args.platform}`,
    `Body length ceiling: ${platform.bodyMaxChars} characters MAX. This is 70% of the platform's "Read more" cutoff — agents prefer captions that read deliberate, not auto-filled. Going below the ceiling is fine; above it is rejected.`,
    `Platform tone: ${platform.tone}`,
    `Hashtags: ${platform.hashtagsRange}`,
    '',
    `Output rules:`,
    `1. Respond with ONLY a JSON array. No prose outside the array. No code-fence markers.`,
    `2. Each element: {"text": "<caption body — no URL, no hashtags>", "hashtags": ["#tag1"]}`,
    `3. Keep "text" at or below the body length ceiling. Hashtags go in the separate field; don't embed them in the body. The AHO listing URL is appended by our code AFTER your output, so you NEVER write any URL — focus on the caption body.`,
    `4. Each variant must be DISTINCT in angle, not just rephrased — see the tone-of-voice block above for which three angles to use for this tone.`,
    `5. Never invent facts. If a field is null/missing in the input, omit it — don't guess. No fabricated yields, schools, awards, or amenities.`,
    `6. Emojis: at most one or two per caption, only where it adds flavor. Never start every caption with an emoji — feels mass-produced.`,
    `7. Avoid "Don't miss out!" / "Limited time!" / fake-urgency phrases. Sophisticated readers spot them and discount the listing.`,
    `8. The agent's social post will display: <body> + newline + <AHO URL> + newline + <hashtags>. So your body should NOT include a CTA pointing at the URL ("Check out this listing!") — the URL appears separately and that line IS the CTA. Your body's job is to make the reader want to click; the URL line does the clicking.`,
  ].join('\n');
}

/** Test-only export: surface the system prompt builder so unit tests
 *  can assert the right tone block + locale voice land in the prompt
 *  without making network calls. */
export const __test__ = { buildSystemPrompt };

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

  const tone: Tone = args.tone ?? DEFAULT_TONE;

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
      system: buildSystemPrompt({ locale: args.locale, platform: args.platform, tone }),
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

  const captions: GeneratedCaption[] = parsed.map((p) => {
    const body = String(p.text ?? '').trim();
    const hashtags = Array.isArray(p.hashtags)
      ? p.hashtags.map((h) => String(h)).filter((h) => h.length > 0)
      : [];
    // Assemble the ready-to-paste string the way the post should look
    // on social. Body, then URL on its own line (when present), then
    // hashtags. Blank lines separate the three blocks for readability.
    const blocks: string[] = [body];
    if (args.listingUrl) blocks.push(args.listingUrl);
    if (hashtags.length > 0) blocks.push(hashtags.join(' '));
    return {
      text: body,
      characterCount: body.length,
      hashtags,
      readyToPaste: blocks.join('\n\n'),
    };
  });

  return {
    captions,
    model: MODEL_ID,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
