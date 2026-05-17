import 'server-only';

import type { PostInput } from '@/lib/social/post-formatter';
import { narrowContentLocale, type Locale } from '@/i18n/config';
import {
  buildSystemPrompt,
  localeToMarket,
  type Market,
} from '@/lib/social/market-prompts';

/**
 * AI caption drafter — Phase J of docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * Pre-share editor only. Generates one draft per requested platform in
 * a single Anthropic Claude Haiku call (tool-use forces structured JSON).
 * The agent reviews + edits + clicks Share — AI never publishes.
 *
 * Hard rules for the model:
 *   - Use ONLY facts in the listing object. Never invent amenities,
 *     views, schools, walkability, neighborhood character, HOA, taxes,
 *     year built. If a field is null, omit it.
 *   - No superlatives, no "won't last", no absolute price claims —
 *     agents are licensed and language carries liability.
 *   - Output JSON matching the tool schema. No prose outside it.
 *
 * Locale rule (Phase 5 onward): each locale maps to a Market via
 * `localeToMarket` in `market-prompts.ts`. Captions are written in
 * the target language — PL drafts in Polish, DE in German, IT in
 * Italian, etc. — using per-market jargon and CTAs. The previous
 * en/es-only fallback (where PL drafts came out in English) is gone.
 * Callers can override the market via DrafterInput.market when the
 * source has extra context (e.g., EN listing in Berlin → market='de').
 *
 * On any error (timeout, 429, malformed JSON, refusal) → return null
 * for each platform. The route handler maps that into a per-platform
 * "AI unavailable" hint; the UI silently falls back to the deterministic
 * template so the agent's flow is never blocked.
 */

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_TIMEOUT_MS = 8000;
const ANTHROPIC_MAX_TOKENS = 600;
const ANTHROPIC_TEMPERATURE = 0.6;

export type DrafterPlatform = 'facebook' | 'instagram' | 'linkedin';

export interface DrafterInput
  extends Pick<
    PostInput,
    | 'title'
    | 'city'
    | 'countryDisplay'
    | 'priceCents'
    | 'currency'
    | 'bedrooms'
    | 'bathrooms'
    | 'areaSqm'
    | 'url'
    | 'locale'
  > {
  /** Pre-formatted price string (e.g. "$225,000") so the model doesn't
   *  have to render currency itself. Built by the route via formatPrice. */
  priceFormatted: string;
  /** Per-market system prompt selector — Phase 5 of
   *  docs/SUPER_PRO_STAGE_1_PLAN.md. When omitted, derived from
   *  `locale` via localeToMarket (en → us, es → es, pl → pl, …).
   *  Callers can override when the source has more context than the
   *  locale alone (e.g., an EN listing in Berlin uses market='de'
   *  for tone but keeps locale='en' for language). */
  market?: Market;
}

export interface DrafterDrafts {
  facebook?: { message: string };
  instagram?: { caption: string };
  linkedin?: {
    commentary: string;
    contentTitle: string;
    contentDescription: string;
  };
}

export interface DrafterResult {
  /** Per-platform draft text. Missing entries = AI failed for that
   *  platform; caller falls back to the deterministic formatter. */
  drafts: DrafterDrafts;
  /** True when AI succeeded for at least one platform. */
  anySuccess: boolean;
  /** Token usage from Anthropic (input + output). For cost tracking. */
  usage?: { inputTokens: number; outputTokens: number };
  /** Categorized failure when the whole call failed (not per-platform). */
  errorCode?:
    | 'no_api_key'
    | 'timeout'
    | 'rate_limited'
    | 'transient_5xx'
    | 'malformed_json'
    | 'refusal'
    | 'unknown';
  errorMessage?: string;
}

// The per-call system prompt is built by `buildSystemPrompt(market)`
// from `@/lib/social/market-prompts`. Phase 5 of
// docs/SUPER_PRO_STAGE_1_PLAN.md replaces the prior global
// SYSTEM_PROMPT (en/es only, with PL/PT/DE/FR/IT silently falling back
// to English) with seven market-specific prompts so each locale gets
// captions in its actual language + local jargon + local CTAs.

interface AnthropicToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicResponse {
  id: string;
  content: Array<AnthropicToolUseBlock | AnthropicTextBlock>;
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface AnthropicErrorResponse {
  type: 'error';
  error?: { type?: string; message?: string };
}

function buildToolSchema(platforms: DrafterPlatform[]): unknown {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  if (platforms.includes('facebook')) {
    properties.facebook = {
      type: 'object',
      properties: {
        message: { type: 'string', minLength: 40, maxLength: 4000 },
      },
      required: ['message'],
    };
    required.push('facebook');
  }
  if (platforms.includes('instagram')) {
    properties.instagram = {
      type: 'object',
      properties: {
        caption: { type: 'string', minLength: 40, maxLength: 2000 },
      },
      required: ['caption'],
    };
    required.push('instagram');
  }
  if (platforms.includes('linkedin')) {
    properties.linkedin = {
      type: 'object',
      properties: {
        commentary: { type: 'string', minLength: 80, maxLength: 2800 },
        contentTitle: { type: 'string', minLength: 5, maxLength: 200 },
        contentDescription: { type: 'string', minLength: 10, maxLength: 256 },
      },
      required: ['commentary', 'contentTitle', 'contentDescription'],
    };
    required.push('linkedin');
  }
  return {
    type: 'object',
    properties,
    required,
  };
}

/**
 * Generate caption drafts for the requested platforms.
 *
 * @param input  — structured listing fields. The model only sees these;
 *                 free-form description deliberately omitted to bound the
 *                 hallucination surface.
 * @param platforms — which platforms to draft for (typically the agent's
 *                    connected accounts).
 * @param apiKey  — Anthropic API key (from serverEnv().ANTHROPIC_API_KEY).
 * @returns DrafterResult — never throws; per-platform misses are silent
 *                          (route falls back to formatter).
 */
export async function generateDrafts(
  input: DrafterInput,
  platforms: DrafterPlatform[],
  apiKey: string | undefined,
): Promise<DrafterResult> {
  if (!apiKey) {
    return {
      drafts: {},
      anySuccess: false,
      errorCode: 'no_api_key',
      errorMessage: 'ANTHROPIC_API_KEY not configured',
    };
  }
  if (platforms.length === 0) {
    return { drafts: {}, anySuccess: false };
  }
  // Phase 5: derive market from locale (en→us, pl→pl, de→de, …)
  // unless caller explicitly overrode. The per-market system prompt
  // enforces "write EVERY word in {target language}" so PL/DE/FR/IT/PT
  // drafts come out in the actual target language — not in English as
  // they did under the old narrowContentLocale fallback.
  const market = input.market ?? localeToMarket(input.locale);

  const userPrompt = JSON.stringify({
    listing: {
      title: input.title,
      city: input.city,
      country: input.countryDisplay,
      priceFormatted: input.priceFormatted,
      currency: input.currency,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      areaSqm: input.areaSqm,
      url: input.url,
      locale: input.locale,
      market,
    },
    platforms,
  });

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    temperature: ANTHROPIC_TEMPERATURE,
    system: buildSystemPrompt(market),
    tools: [
      {
        name: 'emit_drafts',
        description:
          'Emit one draft per requested platform. Output strict JSON.',
        input_schema: buildToolSchema(platforms),
      },
    ],
    tool_choice: { type: 'tool', name: 'emit_drafts' },
    messages: [{ role: 'user', content: userPrompt }],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      drafts: {},
      anySuccess: false,
      errorCode: isAbort ? 'timeout' : 'unknown',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  clearTimeout(timeout);

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return {
      drafts: {},
      anySuccess: false,
      errorCode: res.status >= 500 ? 'transient_5xx' : 'unknown',
      errorMessage: `HTTP ${res.status} (no JSON body)`,
    };
  }

  if (!res.ok) {
    const err = raw as AnthropicErrorResponse;
    const message = err.error?.message ?? `HTTP ${res.status}`;
    let code: DrafterResult['errorCode'] = 'unknown';
    if (res.status === 429) code = 'rate_limited';
    else if (res.status >= 500) code = 'transient_5xx';
    return {
      drafts: {},
      anySuccess: false,
      errorCode: code,
      errorMessage: message,
    };
  }

  const data = raw as AnthropicResponse;
  const toolUse = data.content.find(
    (b): b is AnthropicToolUseBlock => b.type === 'tool_use' && b.name === 'emit_drafts',
  );
  if (!toolUse) {
    // No tool_use block — model refused, returned text only, or returned
    // a different tool. Treat as refusal so caller falls back.
    return {
      drafts: {},
      anySuccess: false,
      errorCode: 'refusal',
      errorMessage: `stop_reason=${data.stop_reason ?? 'unknown'}`,
    };
  }

  const drafts: DrafterDrafts = {};
  const out = toolUse.input as DrafterDrafts;
  if (platforms.includes('facebook') && typeof out.facebook?.message === 'string') {
    drafts.facebook = { message: out.facebook.message };
  }
  if (platforms.includes('instagram') && typeof out.instagram?.caption === 'string') {
    drafts.instagram = { caption: out.instagram.caption };
  }
  if (
    platforms.includes('linkedin') &&
    typeof out.linkedin?.commentary === 'string' &&
    typeof out.linkedin?.contentTitle === 'string' &&
    typeof out.linkedin?.contentDescription === 'string'
  ) {
    drafts.linkedin = {
      commentary: out.linkedin.commentary,
      contentTitle: out.linkedin.contentTitle,
      contentDescription: out.linkedin.contentDescription,
    };
  }

  const anySuccess = Object.keys(drafts).length > 0;
  if (!anySuccess) {
    return {
      drafts: {},
      anySuccess: false,
      errorCode: 'malformed_json',
      errorMessage: 'tool_use block present but no platform fields parsed',
    };
  }

  return {
    drafts,
    anySuccess,
    usage: {
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    },
  };
}

/** Exported for testability — same locale narrowing the route uses. */
export function narrowDrafterLocale(locale: Locale) {
  return narrowContentLocale(locale);
}
