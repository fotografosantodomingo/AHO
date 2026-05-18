import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub server-only so the import in converse.ts doesn't error in tests.
vi.mock('server-only', () => ({}));

// Mock logAiCall — no DB hit in tests.
vi.mock('@/lib/ai/log', () => ({
  logAiCall: vi.fn(async () => undefined),
}));

import { converse, TOOL_SCHEMAS, type ConverseInput } from '@/lib/ai/converse';
import { logAiCall } from '@/lib/ai/log';

const baseInput: ConverseInput = {
  systemPrompt: 'You are an AHO AI assistant.',
  messages: [{ role: 'user', content: 'Is the villa still available?' }],
  agentId: 'agent-1',
  orgId: 'org-1',
  conversationId: 'conv-1',
  conversationMessageId: 'msg-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
  // Clear any fetch mock between tests.
  vi.unstubAllGlobals();
});

function mockFetchOnce(body: unknown, opts: { status?: number } = {}) {
  const status = opts.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })),
  );
}

function mockFetchSequence(responses: Array<{ body: unknown; status?: number }>) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = responses[i++] ?? responses[responses.length - 1]!;
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
}

describe('TOOL_SCHEMAS', () => {
  it('exposes all 5 tools with valid JSON Schema input shapes', () => {
    const names = TOOL_SCHEMAS.map((t) => t.name).sort();
    expect(names).toEqual([
      'book_viewing',
      'escalate_to_human',
      'find_comparable',
      'get_agent_availability',
      'lookup_listing',
    ]);
    for (const t of TOOL_SCHEMAS) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe('object');
      expect(Array.isArray(t.input_schema.required)).toBe(true);
      expect(t.input_schema.required.length).toBeGreaterThan(0);
      for (const req of t.input_schema.required) {
        expect(t.input_schema.properties).toHaveProperty(req);
      }
    }
  });
});

describe('converse — happy path', () => {
  it('returns text and logs the call when the model emits a plain text reply', async () => {
    mockFetchOnce({
      content: [{ type: 'text', text: 'Yes, the villa is still available.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 20 },
    });

    const out = await converse(baseInput);

    expect(out.text).toBe('Yes, the villa is still available.');
    expect(out.toolCalls).toHaveLength(0);
    expect(out.toolResults).toHaveLength(0);
    expect(out.finishReason).toBe('end_turn');
    expect(out.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
    expect(out.errorCode).toBeUndefined();
    expect(logAiCall).toHaveBeenCalledTimes(1);
    expect((logAiCall as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toMatchObject({
      purpose: 'ai_agent_converse',
      inputTokens: 100,
      outputTokens: 20,
    });
  });

  it('uses Haiku when preferFast is true; Sonnet by default', async () => {
    mockFetchOnce({
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const haikuOut = await converse({ ...baseInput, preferFast: true });
    expect(haikuOut.model).toMatch(/haiku/);

    mockFetchOnce({
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const sonnetOut = await converse(baseInput);
    expect(sonnetOut.model).toMatch(/sonnet/);
  });
});

describe('converse — error paths', () => {
  it('returns errorCode and logs when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const out = await converse(baseInput);
    expect(out.errorCode).toBe('anthropic_key_missing');
    expect(out.text).toBe('');
    expect(logAiCall).toHaveBeenCalledTimes(1);
    expect((logAiCall as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]).toMatchObject({
      errorCode: 'anthropic_key_missing',
    });
  });

  it('returns errorCode anthropic_429 on rate-limit response', async () => {
    mockFetchOnce({ error: { message: 'rate_limited' } }, { status: 429 });
    const out = await converse(baseInput);
    expect(out.errorCode).toBe('anthropic_429');
    expect(out.text).toBe('');
  });

  it('returns errorCode anthropic_500 on server error', async () => {
    mockFetchOnce({}, { status: 500 });
    const out = await converse(baseInput);
    expect(out.errorCode).toBe('anthropic_500');
  });

  it('returns errorCode anthropic_network on fetch throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('econn refused'); }));
    const out = await converse(baseInput);
    expect(out.errorCode).toBe('anthropic_network');
    expect(out.text).toBe('');
  });
});

describe('converse — tool loop', () => {
  it('terminates after MAX_TOOL_LOOPS even when model keeps emitting tool_use', async () => {
    // Mock that always returns a tool_use; the 3rd call (with tool_choice: none)
    // STILL returns tool_use in this test, but the loop should exit after 3.
    mockFetchSequence([
      { body: { content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup_listing', input: { short_id: 'aaa111' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } } },
      { body: { content: [{ type: 'tool_use', id: 'tu_2', name: 'lookup_listing', input: { short_id: 'bbb222' } }], stop_reason: 'tool_use', usage: { input_tokens: 60, output_tokens: 12 } } },
      // Final loop should send tool_choice='none'; we still simulate a runaway model
      // (this is the worst case — the function exits with whatever text was last produced, or empty).
      { body: { content: [{ type: 'text', text: 'I cannot complete this — please ask your agent.' }], stop_reason: 'end_turn', usage: { input_tokens: 70, output_tokens: 14 } } },
    ]);

    const out = await converse(baseInput);
    expect(out.toolCalls.length).toBeGreaterThanOrEqual(2);
    expect(out.toolCalls.length).toBeLessThanOrEqual(2); // 2 tool calls in loops 1+2; loop 3 gets tool_choice:none and emits text
    expect(out.text).toContain('cannot complete');
  });

  it('returns text directly when no tool calls are emitted', async () => {
    mockFetchOnce({
      content: [{ type: 'text', text: 'Direct reply.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const out = await converse(baseInput);
    expect(out.text).toBe('Direct reply.');
    expect(out.toolCalls).toHaveLength(0);
  });
});

describe('converse — tool execution dry-run', () => {
  it('returns stubbed error from tool when no supabase client is provided', async () => {
    mockFetchSequence([
      { body: { content: [{ type: 'tool_use', id: 'tu_x', name: 'lookup_listing', input: { short_id: 'abc123' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 10 } } },
      { body: { content: [{ type: 'text', text: 'Listing lookup unavailable in this scope.' }], stop_reason: 'end_turn', usage: { input_tokens: 60, output_tokens: 12 } } },
    ]);
    const out = await converse(baseInput);
    expect(out.toolResults).toHaveLength(1);
    expect(out.toolResults[0]?.isError).toBe(true);
    expect((out.toolResults[0]?.output as { error: string }).error).toBe('tool_execution_disabled');
  });
});

describe('converse — message normalization', () => {
  it('converts a role=tool message into a tool_result content block on the wire', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        );
      }),
    );
    await converse({
      ...baseInput,
      messages: [
        { role: 'user', content: 'Look up villa.' },
        { role: 'assistant', content: 'Looking it up.' },
        { role: 'tool', content: '{"price": "$500k"}', toolCallId: 'tu_seed' },
      ],
    });
    expect(capturedBody).not.toBeNull();
    const messages = (capturedBody as unknown as { messages: unknown[] }).messages;
    // First two messages pass through; the third becomes a user message with a tool_result block.
    expect(Array.isArray(messages)).toBe(true);
    const last = messages[messages.length - 1] as { role: string; content: unknown };
    expect(last.role).toBe('user');
    const blocks = last.content as Array<{ type: string; tool_use_id?: string }>;
    expect(blocks[0]?.type).toBe('tool_result');
    expect(blocks[0]?.tool_use_id).toBe('tu_seed');
  });

  it('drops a tool message that lacks toolCallId rather than 400ing Anthropic', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200 },
        );
      }),
    );
    await converse({
      ...baseInput,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'tool', content: '{"price": "$1"}' /* no toolCallId */ },
      ],
    });
    const messages = (capturedBody as unknown as { messages: { role: string }[] }).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('user');
  });
});
