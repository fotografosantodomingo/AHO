import 'server-only';
import { z } from 'zod';
import { validateBlogHtml, type HtmlValidationError } from '@/lib/blog/html-validate';
import { logAiCall } from '@/lib/ai/log';

/**
 * Blog-post translator. Takes a validated English HTML body + a
 * target locale, returns the same structural contract translated
 * into the target language by Anthropic Haiku.
 *
 * Why Haiku (not Sonnet): translation is a lower-skill task than
 * original authorship. Haiku is ~5× cheaper and produces fluent,
 * accurate translations for editorial real-estate copy. Estimated
 * cost per translation: $0.01-0.02 vs the EN-original $0.05-0.10
 * on Sonnet.
 *
 * Structural contract preservation:
 *   - <h1>, <h2 id>, <h3 id> stay with the SAME id attributes (so
 *     ToC anchors continue to resolve)
 *   - <nav aria-label="Breadcrumb"> + <nav class="table-of-contents">
 *     + <aside class="author-bio-box"> stay verbatim (validator
 *     enforces)
 *   - {HERO_IMG} / {HERO_IMG_400}/800/1200 / {N} / {today}
 *     placeholders survive — the cron substitutes them after the
 *     translation lands
 *   - The author bio's LinkedIn link + the author name stay verbatim
 *     (proper-noun policy)
 *
 * Returns null on any failure (network / 4xx / 5xx / validator
 * reject) — caller skips the locale gracefully without failing the
 * EN publish.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.3; // Translation is mostly deterministic.

const AnthropicResponseSchema = z.object({
  id: z.string(),
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number(),
  }),
});

export type TranslateLocale = 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

const LOCALE_DISPLAY: Record<TranslateLocale, string> = {
  es: 'Spanish (Castilian, with the Spanish-DR regional register)',
  pl: 'Polish',
  pt: 'Portuguese (European register; if any term differs between PT-PT and PT-BR, choose the PT-PT form)',
  de: 'German (Standard German, Sie register for professional content)',
  fr: 'French (Metropolitan, vous register)',
  it: 'Italian (Standard Italian)',
};

export interface TranslatedPost {
  /** Translated <title> body, NO brand suffix. */
  title: string;
  /** Translated summary, capped to ~180 chars. */
  summary: string;
  /** Translated HTML body, structural-contract preserved. */
  bodyHtml: string;
  /** Anthropic usage for cost attribution. */
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsdCents: number;
  model: string;
  latencyMs: number;
}

export type TranslatePostFailure = {
  ok: false;
  error: HtmlValidationError | 'anthropic_network' | 'anthropic_unauthorized' | 'anthropic_rate_limited' | 'anthropic_5xx' | 'anthropic_malformed' | 'anthropic_empty';
  detail?: string;
};

/**
 * Translate an already-validated English HTML body into the target
 * locale. The validated input is the source of truth for structure;
 * the model is told to preserve every tag + every id attribute.
 *
 * Returns either a TranslatedPost (ok=true narrowed) or a failure
 * code the cron writes into the sibling row's failure_reason (when
 * it inserts a per-locale ai_failed row) OR just logs + skips.
 */
export async function translateBlogPost(args: {
  apiKey: string;
  targetLocale: TranslateLocale;
  /** EN article title (no brand suffix). */
  enTitle: string;
  /** EN article summary, ≤180 chars. */
  enSummary: string;
  /** EN article HTML body, post-validateBlogHtml. */
  enBodyHtml: string;
}): Promise<(TranslatedPost & { ok: true }) | TranslatePostFailure> {
  const startedAt = Date.now();

  const system = [
    'You are a professional editorial translator who specializes in real-estate marketing content. Your job is to translate AHO\'s English blog posts into target languages while preserving every HTML structural element verbatim.',
    '',
    `Target language: ${LOCALE_DISPLAY[args.targetLocale]}.`,
    '',
    'NEVER translate:',
    '- Proper nouns: AHO, Advertise Homes Online, Michał Babula, Facebook, Instagram, WhatsApp, LinkedIn, Zillow, Idealista, Otodom, Stripe, etc.',
    '- HTML tag names, attribute names, attribute VALUES that are URLs, ids, or class names. Tag CONTENT (the human-facing text) IS translated.',
    '- The author bio LinkedIn URL: https://www.linkedin.com/in/michal-babula-8aba7241/',
    '- Placeholder strings: {HERO_IMG}, {HERO_IMG_400}, {HERO_IMG_800}, {HERO_IMG_1200}, {N}, {today}',
    '',
    'ALWAYS preserve:',
    '- Every <h2 id="..."> and <h3 id="..."> with its EXACT same id attribute (the in-page ToC links to those ids).',
    '- The <nav aria-label="Breadcrumb">, <nav class="table-of-contents">, and <aside class="author-bio-box"> wrappers verbatim, with translated INNER text where applicable.',
    '- The <img> tag with its width / height / loading / fetchpriority / decoding attributes verbatim.',
    '- HTML structure 1:1 with the source — same tags, same nesting, same order.',
    '',
    'Tone: match the editorial voice of the English original — human, technical, occasionally dry. Never wooden or machine-translated. Translate idioms to their language-equivalent (not literal). Use the target language\'s natural register for an industry-expert blog audience.',
  ].join('\n');

  const user = [
    'INPUT — English article body (already structurally validated):',
    '',
    args.enBodyHtml,
    '',
    'OUTPUT FORMAT: a single JSON object with three string fields, on one line:',
    '',
    '{"title": "<translated headline, no brand suffix>", "summary": "<translated summary, ≤180 chars>", "body_html": "<translated HTML body, structural contract preserved>"}',
    '',
    `Translate the title: "${args.enTitle}"`,
    `Translate the summary: "${args.enSummary}"`,
    '',
    'Then translate the full body HTML. Output ONLY the JSON object — no markdown wrapper, no preamble, no trailing commentary.',
  ].join('\n');

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (e) {
    return {
      ok: false,
      error: 'anthropic_network',
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const code =
      res.status === 401 || res.status === 403 ? 'anthropic_unauthorized'
      : res.status === 429 ? 'anthropic_rate_limited'
      : res.status >= 500 ? 'anthropic_5xx'
      : 'anthropic_malformed';
    await logAiCall({ purpose: 'listing_draft', model: MODEL, inputTokens: 0, outputTokens: 0, latencyMs, errorCode: code });
    return { ok: false, error: code, detail: `HTTP ${res.status}: ${text.slice(0, 280)}` };
  }

  let parsed: z.infer<typeof AnthropicResponseSchema>;
  try {
    const json = (await res.json()) as unknown;
    parsed = AnthropicResponseSchema.parse(json);
  } catch (e) {
    return { ok: false, error: 'anthropic_malformed', detail: e instanceof Error ? e.message : String(e) };
  }

  const text = parsed.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();

  if (!text) {
    await logAiCall({ purpose: 'listing_draft', model: MODEL, inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens, latencyMs, errorCode: 'anthropic_empty' });
    return { ok: false, error: 'anthropic_empty' };
  }

  // Parse the JSON envelope. Strip a ```json wrapper if Haiku slips one in.
  let jsonBody = text;
  const fenced = /^```(?:json)?\s*\n([\s\S]+?)\n```\s*$/.exec(jsonBody);
  if (fenced && fenced[1]) jsonBody = fenced[1];

  let envelope: { title?: unknown; summary?: unknown; body_html?: unknown };
  try {
    envelope = JSON.parse(jsonBody) as typeof envelope;
  } catch (e) {
    return { ok: false, error: 'anthropic_malformed', detail: `JSON parse: ${e instanceof Error ? e.message : String(e)}` };
  }

  const title = typeof envelope.title === 'string' ? envelope.title.trim() : '';
  const summary = typeof envelope.summary === 'string' ? envelope.summary.trim() : '';
  const bodyHtml = typeof envelope.body_html === 'string' ? envelope.body_html : '';

  if (!title || !bodyHtml) {
    return { ok: false, error: 'anthropic_malformed', detail: 'missing title or body_html in JSON envelope' };
  }

  // Validate translated body against the same structural contract.
  // Skips word-count check (Haiku may produce a slightly shorter
  // body in target language and that's fine).
  const validation = validateBlogHtml(bodyHtml);
  if (!validation.ok) {
    await logAiCall({ purpose: 'listing_draft', model: MODEL, inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens, latencyMs, errorCode: validation.error });
    return { ok: false, error: validation.error, detail: validation.detail };
  }

  // Cost — Haiku 4.5: $1.00 / MTok input, $5.00 / MTok output (per cost.ts).
  const inputCents = (parsed.usage.input_tokens / 1_000_000) * 100;
  const outputCents = (parsed.usage.output_tokens / 1_000_000) * 500;
  const estimatedCostUsdCents = Math.round(inputCents + outputCents);

  await logAiCall({ purpose: 'listing_draft', model: MODEL, inputTokens: parsed.usage.input_tokens, outputTokens: parsed.usage.output_tokens, latencyMs, errorCode: null });

  return {
    ok: true,
    title,
    summary: summary.length > 180 ? `${summary.slice(0, 177).trimEnd()}…` : (summary || title),
    bodyHtml: validation.html,
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    estimatedCostUsdCents,
    model: MODEL,
    latencyMs,
  };
}
