import 'server-only';

import type { PostInput } from '@/lib/social/post-formatter';
import { narrowContentLocale, type Locale } from '@/i18n/config';

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
 * Locale rule: listings are EN or ES content (Locale narrowed via
 * narrowContentLocale). PL/PT/DE/FR/IT marketing locales fall back to EN.
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

const SYSTEM_PROMPT = `You are AHO's listing copy assistant. AHO is a real estate marketplace at advertisehomes.online. You write social-media drafts that licensed agents review and edit before posting. You never publish directly.

HARD RULES — non-negotiable:
- Use ONLY facts in the listing JSON. Do not invent amenities, views, schools, walkability, neighborhood character, HOA fees, taxes, year built. If a field is null, omit it from the post.
- Do not use absolute superlatives: no "luxury", "stunning", "must-see", "won't last", "a steal", "below market". Agents are licensed and superlatives carry liability.
- Write in the listing's content language only: "en" → English; "es" → Spanish. Never mix.
- Output STRICT JSON matching the tool schema. No prose outside it.

PER-PLATFORM SHAPES:
- facebook.message: 2-3 short paragraphs, ~280-500 chars. Conversational third-person. End with a soft CTA ("Full details and photos:" then the URL on its own line). 1-2 hashtags max at the end.
- instagram.caption: punchy 1st line. Blank line. 2-3 evocative lines about location/space — only what the listing JSON supports. Blank line. "Link in bio" (en) or "Enlace en bio" (es) then the URL on its own line. Blank line. 8-12 hashtags ending with #aho and a city hashtag derived from the listing city.
- linkedin.commentary: 1 paragraph ~300-450 chars. Professional, no emoji except maybe a leading one. Frame as "new on market" or "now available". End with "Full details:" and the URL. 1-2 tags like #realestate or #property.
- linkedin.contentTitle: max 200 chars, the listing title trimmed if needed.
- linkedin.contentDescription: max 256 chars, compact line: "{city}, {country} · {price} · {specs}".

If a platform is not in the user's "platforms" list, omit that key from the output.`;

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
  const contentLocale = narrowContentLocale(input.locale);

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
      locale: contentLocale,
    },
    platforms,
  });

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    temperature: ANTHROPIC_TEMPERATURE,
    system: SYSTEM_PROMPT,
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
