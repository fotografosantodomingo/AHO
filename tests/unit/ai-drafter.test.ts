/**
 * Unit tests for `src/lib/social/ai-drafter.ts` — Phase J of
 * docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * Mocks `global.fetch` against Anthropic's /v1/messages endpoint.
 * Each test stages a single response and asserts both (a) the returned
 * DrafterResult shape and (b) what we sent in the request body.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateDrafts,
  type DrafterInput,
  type DrafterPlatform,
} from '@/lib/social/ai-drafter';

const BASE: DrafterInput = {
  title: 'Modern 2BR loft near Zona Colonial',
  city: 'Santo Domingo',
  countryDisplay: 'Dominican Republic',
  priceCents: 22_500_000,
  currency: 'USD',
  priceFormatted: '$225,000',
  bedrooms: 2,
  bathrooms: 2,
  areaSqm: 95,
  url: 'https://advertisehomes.online/en/properties/modern-2br-loft-cQF9BN',
  locale: 'en',
};

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockAnthropicResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// ============================================================

describe('ai-drafter · generateDrafts', () => {
  it('returns no_api_key when ANTHROPIC_API_KEY is undefined', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await generateDrafts(BASE, ['facebook'], undefined);
    expect(r.anySuccess).toBe(false);
    expect(r.errorCode).toBe('no_api_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty drafts (no fetch) when platforms array is empty', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await generateDrafts(BASE, [], 'sk-ant-test');
    expect(r.drafts).toEqual({});
    expect(r.anySuccess).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('happy path — 3-platform tool_use response parses into drafts', async () => {
    const fetchMock = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_1',
        content: [
          {
            type: 'tool_use',
            name: 'emit_drafts',
            input: {
              facebook: { message: 'A friendly FB post about the loft.' },
              instagram: {
                caption:
                  '✨ A nice IG caption.\n\nLink in bio:\nhttps://advertisehomes.online/...\n\n#realestate #aho',
              },
              linkedin: {
                commentary: 'New on the market: Modern 2BR loft near Zona Colonial in Santo Domingo.',
                contentTitle: 'Modern 2BR loft near Zona Colonial',
                contentDescription: 'Santo Domingo, Dominican Republic · $225,000 · 2bd · 2ba · 95 m²',
              },
            },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 700, output_tokens: 480 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateDrafts(
      BASE,
      ['facebook', 'instagram', 'linkedin'] as DrafterPlatform[],
      'sk-ant-test',
    );

    expect(r.anySuccess).toBe(true);
    expect(r.drafts.facebook?.message).toContain('friendly FB post');
    expect(r.drafts.instagram?.caption).toContain('Link in bio');
    expect(r.drafts.linkedin?.commentary).toContain('New on the market');
    expect(r.drafts.linkedin?.contentTitle).toBeTruthy();
    expect(r.drafts.linkedin?.contentDescription).toContain('Santo Domingo');
    expect(r.usage).toEqual({ inputTokens: 700, outputTokens: 480 });
    expect(r.errorCode).toBeUndefined();

    // Assert request shape
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const [url, init] = call;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.tools[0].name).toBe('emit_drafts');
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'emit_drafts' });
    // System prompt's hard rules should be in the system field
    expect(body.system).toContain('HARD RULES');
    expect(body.system).toContain('Use ONLY facts in the listing JSON');
    // Listing data should be in the user message
    expect(body.messages[0].content).toContain('Santo Domingo');
    expect(body.messages[0].content).toContain('"locale":"en"');
  });

  it('only requested platforms appear in drafts even if model returns extras', async () => {
    const fetchMock = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_2',
        content: [
          {
            type: 'tool_use',
            name: 'emit_drafts',
            input: {
              facebook: { message: 'FB text' },
              instagram: { caption: 'IG ignored caption' }, // not requested
            },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 500, output_tokens: 100 },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateDrafts(BASE, ['facebook'], 'sk-ant-test');
    expect(r.drafts.facebook?.message).toBe('FB text');
    expect(r.drafts.instagram).toBeUndefined();
  });

  it('locale=es passes "locale":"es" to the model', async () => {
    const fetchMock = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_3',
        content: [
          {
            type: 'tool_use',
            name: 'emit_drafts',
            input: { facebook: { message: 'Texto en español.' } },
          },
        ],
        stop_reason: 'tool_use',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await generateDrafts({ ...BASE, locale: 'es' }, ['facebook'], 'sk-ant-test');
    const call = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.messages[0].content).toContain('"locale":"es"');
  });

  it('marketing locale (pl) passes through + market=pl (Phase 5)', async () => {
    // Phase 5 multilingual context engine (commit 9f39da2) changed this
    // from "narrow PL → EN content" to "pass PL through + market=pl,
    // write actual Polish via per-market system prompt". The prior
    // narrowContentLocale fallback that emitted English drafts under
    // PL/PT/DE/FR/IT marketing locales was the visible quality gap
    // Phase 5 closed.
    const fetchMock = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_4',
        content: [
          {
            type: 'tool_use',
            name: 'emit_drafts',
            input: { facebook: { message: 'Polski tekst.' } },
          },
        ],
        stop_reason: 'tool_use',
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await generateDrafts({ ...BASE, locale: 'pl' }, ['facebook'], 'sk-ant-test');
    const call = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    // locale passes through as 'pl' (not silently narrowed to 'en')
    expect(body.messages[0].content).toContain('"locale":"pl"');
    // market is derived from locale via localeToMarket; pl → pl
    expect(body.messages[0].content).toContain('"market":"pl"');
    // System prompt is now per-market and explicitly tells the model
    // to write in Polish — verify the language rule is in the system.
    expect(body.system).toContain('Polish');
  });

  it('HTTP 429 → rate_limited (no drafts)', async () => {
    global.fetch = vi.fn(async () =>
      mockAnthropicResponse(429, {
        type: 'error',
        error: { type: 'rate_limit_error', message: 'Rate limit hit' },
      }),
    ) as unknown as typeof fetch;

    const r = await generateDrafts(BASE, ['facebook'], 'sk-ant-test');
    expect(r.anySuccess).toBe(false);
    expect(r.errorCode).toBe('rate_limited');
    expect(r.errorMessage).toContain('Rate limit');
  });

  it('HTTP 503 → transient_5xx', async () => {
    global.fetch = vi.fn(async () =>
      mockAnthropicResponse(503, {
        type: 'error',
        error: { message: 'Service unavailable' },
      }),
    ) as unknown as typeof fetch;
    const r = await generateDrafts(BASE, ['facebook'], 'sk-ant-test');
    expect(r.errorCode).toBe('transient_5xx');
  });

  it('fetch throws AbortError (timeout) → timeout code', async () => {
    global.fetch = vi.fn(async () => {
      const e = new Error('Aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;

    const r = await generateDrafts(BASE, ['facebook'], 'sk-ant-test');
    expect(r.errorCode).toBe('timeout');
    expect(r.errorMessage).toContain('Aborted');
  });

  it('no tool_use block in response → refusal', async () => {
    global.fetch = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_refuse',
        content: [
          {
            type: 'text',
            text: 'I cannot help with that.',
          },
        ],
        stop_reason: 'end_turn',
      }),
    ) as unknown as typeof fetch;

    const r = await generateDrafts(BASE, ['facebook'], 'sk-ant-test');
    expect(r.anySuccess).toBe(false);
    expect(r.errorCode).toBe('refusal');
    expect(r.errorMessage).toContain('stop_reason=end_turn');
  });

  it('tool_use block present but no requested platform parsed → malformed_json', async () => {
    global.fetch = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_bad',
        content: [
          {
            type: 'tool_use',
            name: 'emit_drafts',
            input: { instagram: { caption: 'wrong platform' } }, // we asked for FB
          },
        ],
        stop_reason: 'tool_use',
      }),
    ) as unknown as typeof fetch;

    const r = await generateDrafts(BASE, ['facebook'], 'sk-ant-test');
    expect(r.anySuccess).toBe(false);
    expect(r.errorCode).toBe('malformed_json');
  });

  it('LinkedIn requires all three fields — missing contentTitle drops the platform', async () => {
    global.fetch = vi.fn(async () =>
      mockAnthropicResponse(200, {
        id: 'msg_partial',
        content: [
          {
            type: 'tool_use',
            name: 'emit_drafts',
            input: {
              facebook: { message: 'FB ok.' },
              linkedin: {
                commentary: 'commentary present',
                contentDescription: 'desc present',
                // contentTitle missing
              },
            },
          },
        ],
        stop_reason: 'tool_use',
      }),
    ) as unknown as typeof fetch;

    const r = await generateDrafts(
      BASE,
      ['facebook', 'linkedin'],
      'sk-ant-test',
    );
    expect(r.drafts.facebook?.message).toBe('FB ok.');
    expect(r.drafts.linkedin).toBeUndefined();
    expect(r.anySuccess).toBe(true); // FB succeeded
  });
});
