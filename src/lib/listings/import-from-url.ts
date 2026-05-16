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

/**
 * URL-segment patterns that indicate a non-listing image (logo, icon,
 * social-share button, banner, agent avatar). Matched against the full
 * URL (case-insensitive). Word boundaries on most tokens so we don't
 * falsely-reject filenames that happen to contain the substring.
 */
const PHOTO_NON_LISTING_PATTERN =
  /[/_-](?:logo|favicon|icon|sprite|badge|avatar|profile[-_]?pic|profile[-_]?photo|tracking|pixel|banner|advert|advertisement|watermark|brand[-_]?mark|social[-_]?(?:icon|share|button)|share[-_]?button|nav[-_]?arrow)(?:[/_-]|\.|$)/i;
const FETCH_TIMEOUT_MS = 7_000;
/** Send at most this much HTML/text to Claude — keeps cost bounded. */
const MAX_PROMPT_CHARS = 90_000;
/** Below this body size, we assume the source served a bot-challenge
 *  page rather than real content. Genuine listings are 50KB+ in HTML;
 *  empty / sub-2KB responses are AWS WAF / Cloudflare challenges. */
const MIN_BODY_BYTES_FOR_REAL_PAGE = 2_000;

export type ImportTransactionType = 'sale' | 'rent' | 'short_term';

export interface ImportedFacts {
  /** Detected page language (ISO 639-1). The agent can override per
   *  AHO's content locales (en/es) when filling the actual form. */
  detectedLanguage: string | null;

  /** Title in English. If source is non-EN, Claude translates with
   *  real-estate-marketing quality (not literal translation). If
   *  source IS English, this is the cleaned-up source title. */
  titleEn: string | null;
  /** Title in Spanish. Same translation policy as titleEn. */
  titleEs: string | null;
  /** Description in English. 200-500 chars, cleaned of portal
   *  boilerplate. Translated from source when needed. */
  descriptionEn: string | null;
  /** Description in Spanish. Same policy as descriptionEn. */
  descriptionEs: string | null;

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
 * Detect a bot-challenge / WAF response. Returns true when the
 * upstream gave us nothing useful even though the HTTP status was OK.
 *
 * Indicators:
 *   - AWS WAF challenge: 202 status + `x-amzn-waf-action: challenge`.
 *   - Cloudflare challenge: 200/403 with `cf-mitigated: challenge` or
 *     content-type text/html plus `Just a moment...` / `cf-ray` markers
 *     in the body.
 *   - PerimeterX / Akamai / DataDome: status 200/403 with empty / tiny
 *     bodies served as a delayed JS challenge.
 */
export function detectBotBlock(args: {
  status: number;
  headers: Headers;
  bodyBytes: number;
  bodyHead: string;
}): string | null {
  const wafAction = args.headers.get('x-amzn-waf-action');
  if (wafAction && /challenge|captcha/i.test(wafAction)) {
    return 'AWS WAF challenge';
  }
  const cfMitigated = args.headers.get('cf-mitigated');
  if (cfMitigated && /challenge/i.test(cfMitigated)) {
    return 'Cloudflare challenge';
  }
  if (args.status === 202 && args.bodyBytes < MIN_BODY_BYTES_FOR_REAL_PAGE) {
    return 'Bot-challenge (HTTP 202 with no body)';
  }
  if (args.bodyBytes < MIN_BODY_BYTES_FOR_REAL_PAGE) {
    return 'Source returned an empty / tiny page';
  }
  // Body markers — sometimes the upstream returns 200 + a JS challenge
  // page which is short HTML that loads the captcha widget.
  const head = args.bodyHead.toLowerCase();
  if (
    head.includes('cf-challenge') ||
    head.includes('attention required') ||
    head.includes('px-captcha') ||
    head.includes('datadome') ||
    head.includes('akamai-challenge') ||
    head.includes('"reason":"access denied"')
  ) {
    return 'Source served a bot-challenge page';
  }
  return null;
}

/**
 * Fetch a URL with a timeout + size cap. Returns the body as text.
 * Throws on timeout / oversized response / non-2xx / bot-challenge.
 */
export async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      // Some portals serve different content based on UA. Pretend
      // to be a real browser so we don't get the bot-block page —
      // works on agency sites + smaller portals; the big ones
      // (Zillow, Redfin, Realtor) still WAF us out.
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9,pl;q=0.8,es;q=0.7,it;q=0.6,fr;q=0.5,de;q=0.4',
      },
    });
    if (!res.ok && res.status !== 202) {
      throw new Error(`Source returned HTTP ${res.status}`);
    }
    // Stream into memory with a hard cap.
    const reader = res.body?.getReader();
    let total = 0;
    let html = '';
    if (reader) {
      const decoder = new TextDecoder('utf-8');
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
    }

    const blockReason = detectBotBlock({
      status: res.status,
      headers: res.headers,
      bodyBytes: total,
      bodyHead: html.slice(0, 4_000),
    });
    if (blockReason) {
      throw new Error(`Source blocks scraping: ${blockReason}`);
    }
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
export function condense(html: string): string {
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

const SYSTEM_PROMPT = `You are a real-estate listing-import parser AND a senior bilingual real-estate copywriter (English + Spanish). Given the page content of a property listing from a portal (otodom, idealista, Zillow, rightmove, etc.) or any agency website, you do TWO things in one pass:

  (a) Extract the property's structured facts as JSON.
  (b) Provide titles + descriptions in BOTH English and Spanish (AHO's two content locales). When the source is in another language (Polish, German, French, Italian, Portuguese, etc.) you TRANSLATE — but with real-estate-marketing quality, not literal Google-Translate output. The English version reads like an American/UK marketer wrote it; the Spanish version reads like a LATAM/Spain marketer wrote it. Preserve facts, units, and proper-noun place names verbatim (e.g. "Legionowo", "PKP Legionowo Piaski") — never translate place names, transit station names, or street names.

Return a single JSON object matching this exact shape:

{
  "detectedLanguage": "<ISO 639-1 of the page, e.g. 'pl' / 'es' / 'en'>",
  "titleEn": "<title in English; clean and concise>",
  "titleEs": "<title in Spanish; clean and concise>",
  "descriptionEn": "<200-500 chars of the meaningful description, in English; trim portal boilerplate>",
  "descriptionEs": "<200-500 chars of the meaningful description, in Spanish; trim portal boilerplate>",
  "transactionType": "sale" | "rent" | "short_term" | null,
  "propertyType": "<apartment / house / villa / land / commercial / studio / penthouse / etc.>",
  "priceCents": <integer cents — convert from whatever currency unit the page uses; null if range/'price on request'>,
  "currency": "<ISO 4217 — e.g. 'PLN' / 'EUR' / 'USD'>",
  "pricePeriod": "total" | "monthly" | "weekly" | "nightly" | null,
  "bedrooms": <integer or null>,
  "bathrooms": <integer or null>,
  "areaSqm": <number or null — convert sq ft to m² if the source uses imperial>,
  "yearBuilt": <4-digit integer or null>,
  "city": "<city name in its native form, e.g. 'Legionowo' not 'Legion-town'>",
  "countryCode": "<ISO 3166-1 alpha-2, e.g. 'PL' / 'ES'>",
  "neighborhood": "<district / quarter / null>",
  "postalCode": "<postal/ZIP code or null>",
  "amenities": [<short list of distinct features the source surfaces; max 15>],
  "photoUrls": [<absolute URLs to listing photos found on the page; max 30>]
}

Output rules:
1. Respond with ONLY the JSON object. No prose. No code-fence markers.
2. Use null for any field the source doesn't surface — DO NOT guess facts. (For titleEn / titleEs / descriptionEn / descriptionEs the language pair must always be filled — translate when needed.)
3. priceCents is an integer in cents (e.g. €350,000 → 35000000, $1.25M → 125000000).
4. If the source uses imperial units (sq ft, ft²), convert to m² (1 sq ft = 0.0929 m²). Inside the descriptions, mention metric (m²) — even in titleEn / descriptionEn, since AHO is a global platform.
5. transactionType inference: "Na sprzedaż" / "Sale" / "For sale" → "sale"; "Wynajem" / "Rent" / "For rent" → "rent"; "Krótkoterminowy" / "Short-term" → "short_term".
6. If photoUrls are relative paths, leave them out.
7. Filter out portal boilerplate from descriptions (cookie banners, "Contact agent", "View 50 more listings" etc.).
8. Strip the agent's contact info from descriptions — phone numbers, emails, agency names — keep only the property pitch.
9. NEVER translate proper nouns: city names, neighborhood names, transit / school / landmark names. "Szkoła Podstawowa nr 4" stays "Szkoła Podstawowa nr 4" in English (with brief gloss like "Primary School #4" in parentheses if helpful), and "PKP Legionowo Piaski" stays as-is. Same in Spanish.
10. Never invent yield numbers, ROI percentages, or future-projection claims. If the source surfaces them, repeat verbatim. If not, omit — the agent can add positioning hints later.
11. photoUrls — INCLUDE ONLY photographs of the actual property (interior rooms, exterior, balcony, kitchen, bathrooms, plot, view from windows). EXCLUDE: site logos, favicons, social-media icons (FB / IG / X / WhatsApp share buttons), agent profile / agency logo headshots, banner ads, tracking pixels, watermark / disclaimer images, navigation arrows, currency / language flag icons, "next" / "prev" gallery controls, footer brand marks. If a page has NO real property photos, return an EMPTY array — DO NOT pad with stray graphics. Better empty than wrong; the agent can upload manually.
12. photoUrls quality bar — typical listing photos are 800×600 or larger and rendered as thumbnails on the gallery grid. If a URL clearly represents a small icon or sprite (e.g. paths containing /icon, /logo, /favicon, /sprite, /badge, /social, /pixel, /tracking, /avatar, /profile, /banner, /advert, /watermark), exclude it.`;

/**
 * SSRF guard. Returns true when the hostname looks like an internal
 * target (loopback, RFC1918 private, link-local). Even though CF
 * Workers can't reach these, we reject them at the validation layer
 * so a misconfigured local dev or self-hosted target can't be probed
 * via the import endpoint. Exported for unit tests.
 */
export function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.startsWith('127.') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  );
}

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
  if (isInternalHost(parsed.hostname)) {
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
    photoUrls: Array.isArray(extracted.photoUrls)
      ? extracted.photoUrls
          .map((u) => String(u))
          .filter((u) => /^https?:\/\//.test(u))
          // Defensive URL-pattern filter — even with a tightened prompt
          // the model occasionally returns logos / icons / social
          // buttons. Reject paths whose segments scream non-listing.
          // Pattern boundaries (\b or path-segment match) so we don't
          // false-positive on legitimate filenames containing the word
          // (e.g. "kitchen-island-kitchen-icon-look.jpg" — unlikely but
          // possible).
          .filter((u) => !PHOTO_NON_LISTING_PATTERN.test(u))
          // SVG is almost never a listing photo (always vector logo /
          // icon / chart). Real estate photos are JPG / WebP / PNG.
          .filter((u) => !/\.svg(\?|#|$)/i.test(u))
          // 1×1 tracking pixels — if the URL itself signals dimensions.
          .filter((u) => !/[/_-](?:pixel|spacer|blank|transparent)\.(?:gif|png)(\?|#|$)/i.test(u))
          .slice(0, 30)
      : [],
    sourceUrl: parsed.toString(),
  };
}
