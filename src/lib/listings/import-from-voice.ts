/**
 * Voice → property facts import. Day 6 of the Content Hub roadmap.
 *
 * Two-stage pipeline:
 *   1. Audio (≤25 MB, ≤10 min) → OpenAI Whisper API → transcript text.
 *      Whisper handles 99 languages natively; the agent dictates in
 *      whatever language is theirs and Whisper transcribes verbatim.
 *      Cost: ~$0.006/minute audio.
 *   2. Transcript → Claude Sonnet 4.6 with the same fact-extraction +
 *      bilingual translation prompt as the URL importer. Returns
 *      `ImportedFacts` (re-using the URL importer's schema so the
 *      form pre-fill code is shared).
 *
 * Why not have Claude do STT directly: Claude's input is text-only.
 * OpenAI Whisper is industry-standard for STT, supports the AHO
 * locales natively (PL, ES, EN, PT, DE, FR, IT all in the top tier
 * of accuracy), and the cost-per-minute is trivial.
 *
 * The voice flow is the "in-the-field" workflow from CONTENT_HUB_VISION:
 * agent walks out of a property at 14:00, taps "Add new listing →
 * Voice note", dictates: "Mieszkanie 50 metrów, dwa pokoje, wysoki
 * standard, blisko metra Wilanowska, 850 tysięcy", taps Stop.
 * 8-15 seconds later their AHO form is filled.
 */
import type { ImportedFacts } from './import-from-url';

const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL_ID = 'claude-sonnet-4-6';

/** Whisper rejects audio above ~25 MB. We cap at 24 MB to leave
 *  multipart overhead headroom. */
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

interface WhisperResponse {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * STT via OpenAI Whisper. Returns the transcript + detected language.
 * Throws on quota / network / unsupported-format errors.
 */
async function transcribe(args: {
  audio: Blob;
  filename: string;
  /** Optional language hint to Whisper (ISO 639-1). Improves
   *  accuracy on edge dialects when the agent already knows their
   *  locale. We pass the AHO UI locale here. */
  languageHint?: string;
}): Promise<WhisperResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  if (args.audio.size > MAX_AUDIO_BYTES) {
    throw new Error('Audio file too large (max 24 MB ≈ ~10 minutes)');
  }
  const fd = new FormData();
  fd.append('file', args.audio, args.filename);
  fd.append('model', 'whisper-1');
  // Verbose response gives us the detected language + duration —
  // useful for the cost log later.
  fd.append('response_format', 'verbose_json');
  if (args.languageHint) fd.append('language', args.languageHint);

  const res = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Whisper API ${res.status}: ${detail.slice(0, 400)}`);
  }
  const json = (await res.json()) as WhisperResponse;
  if (!json.text || typeof json.text !== 'string') {
    throw new Error('Whisper returned no transcript');
  }
  return json;
}

const SYSTEM_PROMPT = `You are a real-estate listing-import parser AND a senior bilingual real-estate copywriter (English + Spanish). The input you receive is a TRANSCRIPT of an agent's voice note — typically 30 seconds to 3 minutes of spoken description, in any language. Spoken language is fragmented, has missing punctuation, occasional misrecognized words, and the agent jumps between facts in no particular order.

Your job:
  (a) Extract the property's structured facts from the transcript.
  (b) Provide titles + descriptions in BOTH English and Spanish (AHO's two content locales). Translate when needed; preserve proper nouns; real-estate-marketing voice — not a literal transcription with grammar errors. The descriptions should read like a professional listing — the agent's voice note is your raw material, the description is your craft.

Return a single JSON object matching this exact shape:

{
  "detectedLanguage": "<ISO 639-1 of the transcript, e.g. 'pl' / 'es' / 'en'>",
  "titleEn": "<title in English>",
  "titleEs": "<title in Spanish>",
  "descriptionEn": "<200-500 chars of cleaned-up description in English>",
  "descriptionEs": "<200-500 chars of cleaned-up description in Spanish>",
  "transactionType": "sale" | "rent" | "short_term" | null,
  "propertyType": "<apartment / house / villa / land / commercial / studio / penthouse / etc.>",
  "priceCents": <integer cents — the price the agent stated in cents; null if they didn't say>,
  "currency": "<ISO 4217 — infer from the agent's locale (PL → 'PLN', DR/Latam → 'USD' typically, ES → 'EUR'); 'USD' as fallback>",
  "pricePeriod": "total" | "monthly" | "weekly" | "nightly" | null,
  "bedrooms": <integer or null>,
  "bathrooms": <integer or null>,
  "areaSqm": <number or null — convert sq ft to m² if the agent used imperial>,
  "yearBuilt": <4-digit integer or null>,
  "city": "<city name in its native form, e.g. 'Legionowo' not 'Legion-town'>",
  "countryCode": "<ISO 3166-1 alpha-2; infer from city if missing>",
  "neighborhood": "<district / quarter / null>",
  "postalCode": "<postal/ZIP code or null — voice notes rarely contain this>",
  "amenities": [<short list of distinct features the agent mentioned; max 15>],
  "photoUrls": [],
  "sourceUrl": "<voice:transcript>"
}

Output rules:
1. Respond with ONLY the JSON object. No prose. No code-fence markers.
2. Use null for any field the agent didn't explicitly mention — DO NOT guess facts.
3. priceCents is an integer in cents. Spoken numerics: "tysięcy" = thousand (×1000), "milion" = million; "850 tysięcy" → 850000 → priceCents 85000000 (assuming PLN). For USD/EUR, convert similarly.
4. transactionType inference: any spoken hint about sale/rent — "na sprzedaż" / "for sale" → "sale"; "wynajem" / "for rent" → "rent". Default to "sale" if ambiguous.
5. NEVER translate proper nouns: city names, neighborhood names, transit / school / landmark names. "metro Wilanowska" stays "Wilanowska metro" in EN, never "Vilanovska" or similar phonetic guesses.
6. Voice transcripts often have run-on sentences. The descriptions you produce should be GRAMMATICAL professional copy, not the verbatim transcript. Re-shape into clean prose; preserve every fact the agent mentioned.
7. photoUrls is always an empty array — voice notes don't include images. The agent uploads photos via the existing photo uploader after saving.
8. sourceUrl is always the literal string "voice:transcript" — there's no real source URL.`;

/**
 * Voice file → ImportedFacts. The high-level entry point used by the
 * /api/listings/voice-import route + the script for terminal testing.
 */
export async function importFromVoice(args: {
  audio: Blob;
  filename: string;
  /** AHO UI locale of the agent — passed to Whisper as a language
   *  hint and recorded for cost-tracking logs. */
  agentLocale?: string;
}): Promise<ImportedFacts & { transcript: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const stt = await transcribe({
    audio: args.audio,
    filename: args.filename,
    languageHint: args.agentLocale,
  });

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
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Transcript language: ${stt.language ?? args.agentLocale ?? 'unknown'}\n\nTranscript:\n${stt.text}`,
        },
      ],
    }),
  });
  if (!apiRes.ok) {
    const detail = await apiRes.text();
    throw new Error(`Anthropic API ${apiRes.status}: ${detail.slice(0, 400)}`);
  }
  const response = (await apiRes.json()) as AnthropicResponse;
  const text = response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let extracted: Partial<ImportedFacts>;
  try {
    extracted = JSON.parse(text) as Partial<ImportedFacts>;
  } catch (e) {
    throw new Error(
      `Voice extraction returned invalid JSON: ${e instanceof Error ? e.message : e}. Got: ${text.slice(0, 200)}`,
    );
  }

  return {
    detectedLanguage: extracted.detectedLanguage ?? stt.language ?? null,
    titleEn: extracted.titleEn ?? null,
    titleEs: extracted.titleEs ?? null,
    descriptionEn: extracted.descriptionEn ?? null,
    descriptionEs: extracted.descriptionEs ?? null,
    transactionType: (extracted.transactionType as ImportedFacts['transactionType']) ?? null,
    propertyType: extracted.propertyType ?? null,
    priceCents: typeof extracted.priceCents === 'number' ? extracted.priceCents : null,
    currency: extracted.currency ?? null,
    pricePeriod: (extracted.pricePeriod as ImportedFacts['pricePeriod']) ?? null,
    bedrooms: typeof extracted.bedrooms === 'number' ? extracted.bedrooms : null,
    bathrooms: typeof extracted.bathrooms === 'number' ? extracted.bathrooms : null,
    areaSqm: typeof extracted.areaSqm === 'number' ? extracted.areaSqm : null,
    yearBuilt: typeof extracted.yearBuilt === 'number' ? extracted.yearBuilt : null,
    city: extracted.city ?? null,
    countryCode: extracted.countryCode ?? null,
    neighborhood: extracted.neighborhood ?? null,
    postalCode: extracted.postalCode ?? null,
    amenities: Array.isArray(extracted.amenities)
      ? extracted.amenities.map((a) => String(a)).filter((a) => a.length > 0).slice(0, 15)
      : [],
    photoUrls: [],
    sourceUrl: 'voice:transcript',
    transcript: stt.text,
  };
}
