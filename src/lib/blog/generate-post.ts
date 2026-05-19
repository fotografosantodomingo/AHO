import 'server-only';
import { z } from 'zod';
import type { BlogTopic } from '@/lib/blog/topic-pool';
import { PRIMARY_AUTHOR, ARTICLE_REVIEWER } from '@/lib/blog/author';
import { validateBlogHtml, type HtmlValidationError } from '@/lib/blog/html-validate';
import { logAiCall } from '@/lib/ai/log';

/**
 * Programmatic SEO article generator. Calls Anthropic Claude Sonnet
 * with a tight structural-contract prompt, validates the response
 * against the same contract via src/lib/blog/html-validate.ts, and
 * returns either a publish-ready article payload OR a categorized
 * failure code the cron writes into `blog_posts.failure_reason`.
 *
 * Why Sonnet (not Haiku): the article is ~1,200-1,800 words of
 * domain-specific, structurally-constrained, single-shot content.
 * Sonnet's better instruction-following on multi-constraint prompts
 * is worth the ~3x cost. Estimated cost per article: $0.05-0.10.
 *
 * The full prompt is kept here (not in a markdown file) so the
 * tight coupling between prompt + html-validate rules is visible in
 * one place.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4096;
const TEMPERATURE = 0.7;

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

export type GeneratePostError =
  | 'anthropic_unauthorized'
  | 'anthropic_rate_limited'
  | 'anthropic_5xx'
  | 'anthropic_malformed'
  | 'anthropic_empty'
  | 'anthropic_network'
  | HtmlValidationError;

export interface GeneratedPost {
  ok: true;
  /** AI-chosen final title; may differ from `topic.title`. */
  title: string;
  /** One-sentence summary (<= 180 chars). */
  summary: string;
  /** Sanitized HTML body. Embeds breadcrumb + ToC + author bio per
   *  the spec contract. */
  bodyHtml: string;
  /** Author identity snapshot used to populate the row. */
  authorName: string;
  authorRole: string;
  authorUrl: string | null;
  reviewerName: string | null;
  wordCount: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsdCents: number;
  latencyMs: number;
}

export interface GeneratedPostFailure {
  ok: false;
  error: GeneratePostError;
  detail?: string;
  latencyMs: number;
  /** Raw model output when we got one but it failed validation —
   *  helps debugging if the failure email surfaces it. NULL when
   *  the call itself failed (network / 4xx). */
  rawBody?: string | null;
}

/**
 * Build the Anthropic prompt for a single article. The prompt is
 * locked in lock-step with the validator in html-validate.ts; if you
 * change one, change the other.
 */
function buildPrompt(topic: BlogTopic): { system: string; user: string } {
  const reviewerLine = ARTICLE_REVIEWER
    ? `Editorial review line at the bottom: "Reviewed by ${ARTICLE_REVIEWER.name} on {today}".`
    : `Editorial review line at the bottom: "Editorial review by ${PRIMARY_AUTHOR.name} (also the author) on {today}". Be honest that author + reviewer are the same in v1.`;

  const system = [
    `You are ${PRIMARY_AUTHOR.name}, ${PRIMARY_AUTHOR.role}. You write a real-estate-marketing blog at advertisehomes.online/blog about how agents and private sellers compete with portals + Facebook Marketplace using multi-channel distribution. You are a real founder writing real opinions; you are NOT an AI assistant pretending to be a writer.`,
    '',
    `Voice: human, technical, occasionally dry. You acknowledge automation boundaries (e.g., "automation is great for X but falls apart at Y"). You name specific portals (Zillow / Idealista / Otodom) when relevant. You cite specific numbers (engagement rates, commission percentages, conversion ranges) — and never invent stats; if you don't know, write "in my experience" or "from agents I've spoken to" rather than fabricating a 17.4% figure.`,
    '',
    'BANNED phrases — using any of these triggers a republish and reduces your byline trust score: "delve", "in conclusion", "testament to", "revolutionize", "in today\'s fast-paced", "navigate the landscape", "unleash", "leverage" (as a verb), "unlock the potential".',
  ].join('\n');

  const user = [
    `TOPIC: ${topic.title}`,
    '',
    `ANGLE: ${topic.prompt}`,
    '',
    'OUTPUT FORMAT: raw semantic HTML5 only. NO markdown wrapper, NO triple-backtick fences. Start the response with the first HTML element and end with the last one. Do not include <!DOCTYPE>, <html>, <head>, <body> — the page shell handles those.',
    '',
    'STRUCTURAL CONTRACT (every rule is automatically validated; failing any rule rejects the post):',
    '',
    '1. First element: <nav aria-label="Breadcrumb"> with three links: Home → Blog → {article title}. Use <ol> + <li> with <a href> for the first two; the current page as plain text in the last <li>.',
    '',
    '2. Title: a single <h1> with the article title. No id needed on h1.',
    '',
    '3. Meta line directly under h1 (small <p> with byline + reading-time placeholder):',
    `   "By ${PRIMARY_AUTHOR.name} · ~{N} min read · {today}" — emit "{N}" and "{today}" as literal placeholder strings, the cron will substitute.`,
    '',
    '4. Table of Contents block: <nav class="table-of-contents" aria-label="Table of contents"><ol><li><a href="#section-id">Section title</a></li>...</ol></nav>',
    '   Every <h2 id="..."> AND every <h3 id="..."> in the article body MUST have a corresponding ToC link, and every ToC link MUST point at an id that exists. Use kebab-case ids derived from the heading text.',
    '',
    '5. Body: 1,200 - 1,800 words across 4-6 H2 sections + optional H3 subsections. Use <p>, <ul>, <ol>, <blockquote>, <code> inline where it helps. Include at least one realistic example or short case (anonymized agent or city is fine; do not name a real person who didn\'t consent).',
    '',
    '6. Hero <img> placed IMMEDIATELY after the Table-of-Contents <nav> (above the first <h2>). This image is the LCP element — the browser must be able to fetch it eagerly with high priority, so include `fetchpriority="high"` and `loading="eager"` (NOT `lazy`). Use this EXACT markup:',
    '   <img src="{HERO_IMG}" srcset="{HERO_IMG_400} 400w, {HERO_IMG_800} 800w, {HERO_IMG_1200} 1200w" sizes="(max-width: 800px) 100vw, 800px" width="1200" height="630" fetchpriority="high" loading="eager" decoding="async" alt="...">',
    '   Choose a descriptive alt text that matches the article angle (not the literal background gradient). Do NOT inline a real photo URL — leave the placeholders intact. The width / height attributes MUST be `1200` and `630` (the hero card\'s rendered dimensions); their omission triggers a CLS regression. fetchpriority + eager loading are REQUIRED — `loading="lazy"` on the LCP element regresses LCP by 1-2 seconds.',
    '',
    '7. NO Microdata. NO itemprop, itemscope, itemtype anywhere. All schema lives in JSON-LD in the page <head> (separately stamped by the page-render path).',
    '',
    `8. ${reviewerLine}`,
    '',
    `9. Author bio at the very bottom: <aside class="author-bio-box"><h3>About the author</h3><p>${PRIMARY_AUTHOR.bioParagraph}</p><p><a href="${PRIMARY_AUTHOR.url}" target="_blank" rel="noopener">LinkedIn</a></p></aside>`,
    '   You must include this EXACT <aside class="author-bio-box"> wrapper. The bio paragraph can be your own writing; only the wrapper + the LinkedIn link are required verbatim.',
    '',
    'TONE BANS: see system prompt. Sentence length should vary; do not write a Wikipedia article.',
    '',
    'OUTPUT NOW. Start with the breadcrumb <nav>.',
  ].join('\n');

  return { system, user };
}

/**
 * Map an HTTP status code from Anthropic's API to a categorized
 * error code the cron writes into failure_reason.
 */
function categorizeHttpError(status: number): GeneratePostError {
  if (status === 401 || status === 403) return 'anthropic_unauthorized';
  if (status === 429) return 'anthropic_rate_limited';
  if (status >= 500) return 'anthropic_5xx';
  return 'anthropic_malformed';
}

/**
 * Rough cost estimate so the row carries the same `estimated_cost_usd_cents`
 * the rest of the ai_generation_log uses. Sonnet 4.6 pricing (Jan 2026
 * snapshot): $3.00 / MTok input, $15.00 / MTok output.
 */
function estimateCostCents(inputTokens: number, outputTokens: number): number {
  const inputCents = (inputTokens / 1_000_000) * 300;
  const outputCents = (outputTokens / 1_000_000) * 1500;
  return Math.round(inputCents + outputCents);
}

export async function generateBlogPost(
  topic: BlogTopic,
  apiKey: string,
): Promise<GeneratedPost | GeneratedPostFailure> {
  const { system, user } = buildPrompt(topic);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
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
      latencyMs: Date.now() - startedAt,
      rawBody: null,
    };
  }

  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    const code = categorizeHttpError(res.status);
    const text = await res.text().catch(() => '');
    // Log the failed call too — observability matters for cost +
    // rate-limit visibility.
    await logAiCall({
      purpose: 'listing_draft', // closest existing purpose enum value
      model: MODEL,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      errorCode: code,
    });
    return {
      ok: false,
      error: code,
      detail: `HTTP ${res.status}: ${text.slice(0, 280)}`,
      latencyMs,
      rawBody: null,
    };
  }

  let parsed: z.infer<typeof AnthropicResponseSchema>;
  try {
    const json = (await res.json()) as unknown;
    parsed = AnthropicResponseSchema.parse(json);
  } catch (e) {
    return {
      ok: false,
      error: 'anthropic_malformed',
      detail: e instanceof Error ? e.message : String(e),
      latencyMs,
      rawBody: null,
    };
  }

  const text = parsed.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();

  if (!text) {
    await logAiCall({
      purpose: 'listing_draft',
      model: MODEL,
      inputTokens: parsed.usage.input_tokens,
      outputTokens: parsed.usage.output_tokens,
      latencyMs,
      errorCode: 'anthropic_empty',
    });
    return {
      ok: false,
      error: 'anthropic_empty',
      latencyMs,
      rawBody: null,
    };
  }

  const validation = validateBlogHtml(text);
  if (!validation.ok) {
    await logAiCall({
      purpose: 'listing_draft',
      model: MODEL,
      inputTokens: parsed.usage.input_tokens,
      outputTokens: parsed.usage.output_tokens,
      latencyMs,
      errorCode: validation.error,
    });
    return {
      ok: false,
      error: validation.error,
      detail: validation.detail,
      latencyMs,
      rawBody: text,
    };
  }

  // Title + summary extraction from the validated HTML. Best-effort
  // — if either parse fails we fall back to the topic title + a
  // simple description.
  const titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(validation.html);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || topic.title;

  const firstParaMatch = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(
    // Skip past the H1 + meta-byline paragraph; first real <p> after
    // the ToC nav is the article opener.
    validation.html.replace(/^[\s\S]*?<\/nav>\s*<\/nav>/i, ''),
  );
  const summaryRaw = firstParaMatch?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  const summary =
    summaryRaw.length > 180 ? `${summaryRaw.slice(0, 177).trimEnd()}…` : summaryRaw || topic.title;

  await logAiCall({
    purpose: 'listing_draft',
    model: MODEL,
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    latencyMs,
    errorCode: null,
  });

  return {
    ok: true,
    title,
    summary,
    bodyHtml: validation.html,
    authorName: PRIMARY_AUTHOR.name,
    authorRole: PRIMARY_AUTHOR.role,
    authorUrl: PRIMARY_AUTHOR.url,
    reviewerName: ARTICLE_REVIEWER?.name ?? null,
    wordCount: validation.wordCount,
    model: MODEL,
    inputTokens: parsed.usage.input_tokens,
    outputTokens: parsed.usage.output_tokens,
    estimatedCostUsdCents: estimateCostCents(parsed.usage.input_tokens, parsed.usage.output_tokens),
    latencyMs,
  };
}

/**
 * Stamp `{N}`, `{today}`, and hero-image placeholders into the
 * generated HTML body just before insert. Called by the cron route
 * after generateBlogPost() succeeds.
 */
export function stampBodyPlaceholders(args: {
  html: string;
  wordCount: number;
  publishedAt: Date;
  heroImageUrl: string | null;
  heroImageSrcsetByWidth: Record<400 | 800 | 1200, string> | null;
}): string {
  const readingMin = Math.max(2, Math.round(args.wordCount / 220));
  const todayLabel = args.publishedAt.toISOString().slice(0, 10);
  let out = args.html;
  out = out.replace(/{N}/g, String(readingMin));
  out = out.replace(/{today}/g, todayLabel);
  if (args.heroImageUrl && args.heroImageSrcsetByWidth) {
    out = out.replace(/{HERO_IMG}/g, args.heroImageUrl);
    out = out.replace(/{HERO_IMG_400}/g, args.heroImageSrcsetByWidth[400]);
    out = out.replace(/{HERO_IMG_800}/g, args.heroImageSrcsetByWidth[800]);
    out = out.replace(/{HERO_IMG_1200}/g, args.heroImageSrcsetByWidth[1200]);
  } else {
    // No hero image — strip the whole <img ...> tag that references
    // the placeholders so the page doesn't render a broken-image icon.
    out = out.replace(
      /<img\b[^>]*\{HERO_IMG\}[^>]*>/g,
      '',
    );
  }
  return out;
}
