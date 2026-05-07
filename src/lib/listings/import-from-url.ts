import type { Locale } from '@/i18n/config';

/**
 * URL → property facts import. Day 5 of the Content Hub roadmap.
 *
 * Flow:
 *   1. Fetch the source page HTML (timeout + size cap so a slow
 *      portal can't stall the worker).
 *   2. Strip the obvious noise (<script>, <style>, repetitive nav)
 *      to bring the body under Claude's context budget without
 *      losing schema.org / OpenGraph data.
 *   3. Send to Claude with a strict-JSON system prompt that asks
 *      for the exact field set our `properties` schema uses.
 *
 * Cost target: < $0.10 per import. Achievable because most useful
 * facts on real-estate portals are in JSON-LD + meta tags + the
 * first 20KB of body text — we don't need to send the whole page.
 *
 * Supported portals (well): otodom.pl, idealista.com, zillow.com,
 * rightmove.co.uk, immobilienscout24.de, leboncoin.fr. Generic
 * fallback works for anything where the listing's facts are
 * surfaced via schema.org RealEstateListing or visible on the
 * first body screen.
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MODEL_ID = 'claude-sonnet-4-6';

/** Cap to prevent a malicious or huge page from stalling the worker. */
const MAX_FETCH_BYTES = 1_500_000; // 1.5 MB
const FETCH_TIMEOUT_MS = 8_000;
/** Send at most this much HTML/text to Claude — keeps cost bounded. */
const MAX_PROMPT_CHARS = 90_000;

export type ImportTransactionType = 'sale' | 'rent' | 'short_term';

export interface ImportedFacts {
  /** Detected page language (ISO 639-1). The agent can override per
   *  AHO's content locales (en/es) when filling the actual form. */
  detectedLanguage: string | null;

  /** Title — usually the page's <h1> or schema.org headline. */
  title: string | null;
  /** A 200-500 char description, cleaned up. */
  description: string | null;

  transactionType: ImportTransactionType | null;
  /** Property type as a free-text string the model picked from the
   *  page ("apartment", "house", "villa", etc.). The form maps this
   *  to AHO's enum on the way in. */
  propertyType: string | null;

  /** Headline price. Always parsed to integer cents. NULL if the
   *  source listed a range or "Cena na żądanie". */
  priceCents: number | null;
  /** ISO 4217. Inferred from the source's currency symbol. */
  currency: string | null;
  /** Recurring period when applicable (rent / short_term).
   *  null for sale. */
  pricePeriod: 'total' | 'monthly' | 'weekly' | 'nightly' | null;

  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  yearBuilt: number | null;

  city: string | null;
  /** ISO 3166-1 alpha-2 (e.g. "PL", "ES"). */
  countryCode: string | null;
  neighborhood: string | null;
  postalCode: string | null;

  /** A short list of features the agent can curate on import — not
   *  AHO's enumerated amenities, just whatever signals the source
   *  surfaced ("south-facing", "elevator", "garden", "parking"). */
  amenities: string[];

  /** Photo URLs we found in the source. NOT downloaded — that's a
   *  Sprint-2 task. The form shows them as "found photos" and the
   *  agent picks which to import; AHO's image pipeline downloads on
   *  save. */
  photoUrls: string[];

  /** The source URL we imported from — stored for audit + potential
   *  re-import on schema changes. */
  sourceUrl: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Fetch a URL with a timeout + size cap. Returns the body as text.
 * Throws on timeout / oversized response / non-2xx.
 */
async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Some portals serve different content based on UA. Pretend
      // to be a real browser so we don't get the bot-block page.
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,pl;q=0.8,es;q=0.7,it;q=0.6,fr;q=0.5,de;q=0.4',
      },
    });
    if (!res.ok) {
      throw new Error(`Source returned HTTP ${res.status}`);
    }
    // Stream into memory with a hard cap.
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('No body on source response');
    }
    const decoder = new TextDecoder('utf-8');
    let total = 0;
    let html = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FETCH_BYTES) {
        throw new Error('Source page too large');
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Boil the page down to the highest-signal regions for the LLM:
 *   - <title>
 *   - meta tags (description, OpenGraph)
 *   - schema.org JSON-LD blocks (where most portals put structured data)
 *   - first ~70KB of visible body text
 *
 * The result is roughly an order of magnitude smaller than the raw
 * page and still contains everything we extract.
 */
function condense(html: string): string {
  // Pull schema.org JSON-LD scripts — these are gold for portals that
  // emit them (otodom does, idealista does, Zillow does on Search but
  // not always on detail pages).
  const ldBlocks: string[] = [];
  const ldRe = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRe.exec(html)) !== null) {
    ldBlocks.push(m[1]?.trim() ?? '');
    if (ldBlocks.join('').length > 30_000) break;
  }

  // Pull <title> + relevant meta.
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const ogMatches = Array.from(
    html.matchAll(/<meta[^>]*property=["'](og:[^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi),
  ).map((mm) => `${mm[1]}: ${mm[2]}`);
  const descMeta = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i.exec(html);
  const langMatch = /<html[^>]*lang=["']([^"']+)["']/i.exec(html);

  // Strip script/style/svg, then drop tags to leave plain-ish text.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sections: string[] = [];
  if (titleMatch?.[1]) sections.push(`TITLE: ${titleMatch[1].trim()}`);
  if (langMatch?.[1]) sections.push(`HTML_LANG: ${langMatch[1].trim()}`);
  if (descMeta?.[1]) sections.push(`META_DESCRIPTION: ${descMeta[1].trim()}`);
  if (ogMatches.length) sections.push(`OG_TAGS:\n${ogMatches.join('\n')}`);
  if (ldBlocks.length) sections.push(`JSON_LD:\n${ldBlocks.join('\n---\n')}`);
  sections.push(`BODY_TEXT: ${stripped.slice(0, 60_000)}`);

  const joined = sections.join('\n\n');
  return joined.length > MAX_PROMPT_CHARS
    ? joined.slice(0, MAX_PROMPT_CHARS)
    : joined;
}

const SYSTEM_PROMPT = `You are a real-estate listing-import parser. Given the page content of a property listing from a portal (otodom, idealista, Zillow, rightmove, etc.) or any agency website, extract the property's facts and return them as a single JSON object matching this exact shape:

{
  "detectedLanguage": "<ISO 639-1 of the page, e.g. 'pl' / 'es' / 'en'>",
  "title": "<the listing's title — clean it up if obviously truncated>",
  "description": "<200-500 chars of the meaningful description; trim portal boilerplate>",
  "transactionType": "sale" | "rent" | "short_term" | null,
  "propertyType": "<apartment / house / villa / land / commercial / studio / penthouse / etc.>",
  "priceCents": <integer cents — convert from whatever currency unit the page uses; null if range/'price on request'>,
  "currency": "<ISO 4217 — e.g. 'PLN' / 'EUR' / 'USD'>",
  "pricePeriod": "total" | "monthly" | "weekly" | "nightly" | null,
  "bedrooms": <integer or null>,
  "bathrooms": <integer or null>,
  "areaSqm": <number or null — convert sq ft to m² if the source uses imperial>,
  "yearBuilt": <4-digit integer or null>,
  "city": "<city name>",
  "countryCode": "<ISO 3166-1 alpha-2, e.g. 'PL' / 'ES'>",
  "neighborhood": "<district / quarter / null>",
  "postalCode": "<postal/ZIP code or null>",
  "amenities": [<short list of distinct features the source surfaces; max 15>],
  "photoUrls": [<absolute URLs to listing photos found on the page; max 30>]
}

Output rules:
1. Respond with ONLY the JSON object. No prose. No code-fence markers.
2. Use null for any field the source doesn't surface — DO NOT guess.
3. priceCents is an integer in cents (e.g. €350,000 → 35000000, $1.25M → 125000000).
4. If the source uses imperial units (sq ft, ft²), convert to m² (1 sq ft = 0.0929 m²).
5. transactionType inference: "Na sprzedaż" / "Sale" / "For sale" → "sale"; "Wynajem" / "Rent" / "For rent" → "rent"; "Krótkoterminowy" / "Short-term" → "short_term".
6. If photoUrls are relative paths, leave them out — they're not useful without the source's full URL context.
7. Filter out portal boilerplate from description (cookie banners, "Contact agent", "View 50 more listings" etc.).
8. Strip the agent's contact info from description — phone numbers, emails, agency names — keep only the property pitch.`;

export async function importFromUrl(args: {
  url: string;
  /** Caller's locale — passed only for logging / context; we still
   *  return data in the source's language and let the agent translate
   *  on the form side. */
  callerLocale?: Locale;
}): Promise<ImportedFacts> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https');
  }
  // Quick SSRF guard — block obvious internal targets even though
  // CF Workers wouldn't reach them anyway.
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('169.254.')
  ) {
    throw new Error('URL points to an internal address');
  }

  const html = await fetchPage(parsed.toString());
  const condensed = condense(html);

  const userPrompt = [
    `Source URL: ${parsed.toString()}`,
    '',
    `Page content:`,
    condensed,
  ].join('\n');

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
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!apiRes.ok) {
    const detail = await apiRes.text();
    throw new Error(
      `Anthropic API ${apiRes.status}: ${detail.slice(0, 400)}`,
    );
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
      `Extraction returned invalid JSON: ${e instanceof Error ? e.message : e}. Got: ${text.slice(0, 200)}`,
    );
  }

  return {
    detectedLanguage: extracted.detectedLanguage ?? null,
    title: extracted.title ?? null,
    description: extracted.description ?? null,
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
    photoUrls: Array.isArray(extracted.photoUrls)
      ? extracted.photoUrls.map((u) => String(u)).filter((u) => /^https?:\/\//.test(u)).slice(0, 30)
      : [],
    sourceUrl: parsed.toString(),
  };
}
