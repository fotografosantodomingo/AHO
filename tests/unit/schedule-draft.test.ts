/**
 * Tests for `src/lib/ai/schedule-draft.ts` — the async AI-draft
 * scheduler the inbound email + WhatsApp routes call after persisting
 * a buyer's user-turn.
 *
 * Mocks `server-only` (it's a build-time module that errors in
 * vitest), mocks `@/lib/ai/log` (no DB), and stubs `globalThis.fetch`
 * to control the Anthropic round-trip. Supabase is hand-stubbed —
 * each `.from(table)` call returns a chainable builder whose
 * terminator (`.maybeSingle`, `.single`, `await`) consumes a staged
 * response from a per-table queue.
 *
 * The mock pattern mirrors `tests/unit/agent-converse.test.ts` for
 * the Anthropic side and `tests/unit/knowledge-fetcher.test.ts` for
 * the Supabase side.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub server-only so the imports don't error in the test runtime.
vi.mock('server-only', () => ({}));

// Mock logAiCall — converse() calls it; no DB hit needed.
vi.mock('@/lib/ai/log', () => ({
  logAiCall: vi.fn(async () => undefined),
}));

import { scheduleDraft } from '@/lib/ai/schedule-draft';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Fake supabase ────────────────────────────────────────────────────

interface StubResponse {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
  count?: number;
}

type ResponseQueue = StubResponse[];

interface RecordedCall {
  table: string;
  op:
    | 'select'
    | 'insert'
    | 'update'
    | 'maybeSingle'
    | 'single'
    | 'await';
  payload?: unknown;
}

class FakeQueryBuilder {
  private trace: string[] = [];
  private pendingPayload: unknown = undefined;
  private operation: 'select' | 'insert' | 'update' = 'select';

  constructor(
    private readonly table: string,
    private readonly responses: Map<string, ResponseQueue>,
    private readonly recorded: RecordedCall[],
    private readonly inserts: Map<string, unknown[]>,
    private readonly updates: Map<string, unknown[]>,
  ) {}

  private record(method: string): this {
    this.trace.push(method);
    return this;
  }

  insert(payload: unknown) {
    this.operation = 'insert';
    this.pendingPayload = payload;
    const list = this.inserts.get(this.table) ?? [];
    list.push(payload);
    this.inserts.set(this.table, list);
    this.recorded.push({ table: this.table, op: 'insert', payload });
    return this.record('insert');
  }

  update(payload: unknown) {
    this.operation = 'update';
    this.pendingPayload = payload;
    const list = this.updates.get(this.table) ?? [];
    list.push(payload);
    this.updates.set(this.table, list);
    this.recorded.push({ table: this.table, op: 'update', payload });
    return this.record('update');
  }

  select(_cols?: string, _opts?: { count?: 'exact'; head?: boolean }) {
    if (this.operation === 'select') {
      this.recorded.push({ table: this.table, op: 'select' });
    }
    return this.record('select');
  }
  eq(_col: string, _val: unknown) {
    return this.record('eq');
  }
  gte(_col: string, _val: unknown) {
    return this.record('gte');
  }
  lte(_col: string, _val: unknown) {
    return this.record('lte');
  }
  not(_col: string, _op: string, _val: unknown) {
    return this.record('not');
  }
  in(_col: string, _vals: unknown[]) {
    return this.record('in');
  }
  order(_col: string, _opts?: unknown) {
    return this.record('order');
  }
  limit(_n: number) {
    return this.record('limit');
  }

  private resolve(): StubResponse {
    const queue = this.responses.get(this.table);
    if (!queue || queue.length === 0) {
      throw new Error(
        `[FakeSupabase] No staged response for table='${this.table}' (op=${this.operation}). Trace: ${this.trace.join(' → ')}`,
      );
    }
    return queue.shift()!;
  }

  maybeSingle<T = unknown>(): Promise<{
    data: T | null;
    error: StubResponse['error'];
  }> {
    this.recorded.push({ table: this.table, op: 'maybeSingle' });
    const r = this.resolve();
    return Promise.resolve({ data: (r.data as T | null) ?? null, error: r.error });
  }

  single<T = unknown>(): Promise<{
    data: T | null;
    error: StubResponse['error'];
  }> {
    this.recorded.push({ table: this.table, op: 'single' });
    const r = this.resolve();
    return Promise.resolve({ data: (r.data as T | null) ?? null, error: r.error });
  }

  then<TResolved = unknown>(
    onFulfilled: (value: {
      data: unknown[] | null;
      error: StubResponse['error'];
      count?: number;
    }) => TResolved,
    onRejected?: (reason: unknown) => TResolved,
  ): Promise<TResolved> {
    this.recorded.push({ table: this.table, op: 'await' });
    try {
      const r = this.resolve();
      return Promise.resolve(
        onFulfilled({
          data: (r.data as unknown[] | null) ?? null,
          error: r.error,
          count: r.count,
        }),
      );
    } catch (err) {
      if (onRejected) return Promise.resolve(onRejected(err));
      return Promise.reject(err);
    }
  }
}

function makeFakeSupabase() {
  const responses = new Map<string, ResponseQueue>();
  const recorded: RecordedCall[] = [];
  const inserts = new Map<string, unknown[]>();
  const updates = new Map<string, unknown[]>();

  function setTableResponses(table: string, list: StubResponse[]): void {
    responses.set(table, [...list]);
  }

  const client = {
    from(table: string) {
      return new FakeQueryBuilder(table, responses, recorded, inserts, updates);
    },
  } as unknown as SupabaseClient;

  return { client, setTableResponses, recorded, inserts, updates };
}

// ─── Fixtures ─────────────────────────────────────────────────────────

const CONV_ID = '00000000-0000-0000-0000-0000000000c0';
const ORG_ID = '00000000-0000-0000-0000-0000000000a1';
const AGENT_ID = '00000000-0000-0000-0000-0000000000a2';
const OTHER_ORG_ID = '00000000-0000-0000-0000-0000000000a3';

const happyConversation = {
  id: CONV_ID,
  org_id: ORG_ID,
  agent_id: AGENT_ID,
  property_id: null,
  channel: 'email',
  buyer_locale: 'en',
};

const happyAgent = {
  id: AGENT_ID,
  full_name: 'Maria Lopez',
  bio: 'Bilingual agent.',
  specialties: ['Beachfront'],
  languages_spoken: ['en', 'es'],
};

const happyOrg = {
  id: ORG_ID,
  name: 'Lopez Realty',
  slug: 'lopez-realty',
  headquarters_country: 'US',
};

/** Stage every table fetchKnowledge + plan-gating + scheduleDraft hit
 *  with empty/baseline data for a vanilla happy path. The order of
 *  reviews entries matters: topReview (maybeSingle) fires first,
 *  aggregate (await) fires second — same as knowledge-fetcher.test.ts. */
function stageHappyPathReads(
  setTable: (t: string, r: StubResponse[]) => void,
  priorMessages: Array<{ role: string; body: string; created_at: string }>,
) {
  // Conversation lookup (scheduleDraft step 1)
  setTable('ai_conversations', [
    { data: happyConversation, error: null },
    // Update bump_last_message_at (step 12) — terminates via `await`, no data needed
    { data: null, error: null },
  ]);
  // Agent profile lookup (scheduleDraft step 2) + fetchKnowledge profile
  setTable('profiles', [
    { data: happyAgent, error: null },
    { data: happyAgent, error: null },
  ]);
  // organizations: TWO hits in order:
  //   1. scheduleDraft step 2 — fetch org row by id (maybeSingle)
  //   2. getOrgPlanId (plan-gating) — fetch current_plan_id (maybeSingle)
  setTable('organizations', [
    { data: happyOrg, error: null },
    { data: { current_plan_id: null }, error: null },
  ]);
  // fetchKnowledge uses organization_members for org name + slug
  setTable('organization_members', [
    {
      data: {
        org_id: ORG_ID,
        organizations: { id: ORG_ID, name: 'Lopez Realty', slug: 'lopez-realty' },
      },
      error: null,
    },
  ]);
  // fetchKnowledge listings (await terminator → list)
  setTable('properties', [{ data: [], error: null }]);
  // fetchKnowledge FAQs
  setTable('agent_faqs', [{ data: [], error: null }]);
  // fetchKnowledge reviews: top first (maybeSingle), aggregate second (await)
  setTable('reviews', [
    { data: null, error: null },
    { data: [], error: null, count: 0 },
  ]);
  // Prior messages list (step 7)
  setTable('ai_conversation_messages', [
    { data: priorMessages, error: null },
    // Assistant insert (step 11)
    {
      data: { id: 'msg-generated-12345' },
      error: null,
    },
  ]);
}

function mockAnthropicResponseOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
  vi.unstubAllGlobals();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────

describe('scheduleDraft — guard rails', () => {
  it('returns conversation_not_found when the conversationId is missing', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('ai_conversations', [{ data: null, error: null }]);

    const out = await scheduleDraft({
      supabase: client,
      conversationId: CONV_ID,
      agentId: AGENT_ID,
      orgId: ORG_ID,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe('conversation_not_found');
    expect(out.messageId).toBeUndefined();
  });

  it('returns org_mismatch when the conversation belongs to a different org', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('ai_conversations', [
      {
        data: { ...happyConversation, org_id: OTHER_ORG_ID },
        error: null,
      },
    ]);

    const out = await scheduleDraft({
      supabase: client,
      conversationId: CONV_ID,
      agentId: AGENT_ID,
      orgId: ORG_ID,
    });

    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe('org_mismatch');
  });
});

describe('scheduleDraft — happy path', () => {
  it('inserts an assistant row with approval_status="pending", risk_flags, intent, confidence, and bumps last_message_at', async () => {
    const { client, setTableResponses, inserts, updates } = makeFakeSupabase();
    // Staged in DESCENDING created_at order — that's what supabase
    // returns when the helper calls .order('created_at', { ascending: false }).
    // The helper then .slice().reverse() to walk it in chronological order.
    const priorMessages = [
      { role: 'user', body: 'Is the villa still available?', created_at: '2026-05-18T00:00:00Z' },
    ];
    stageHappyPathReads(setTableResponses, priorMessages);

    mockAnthropicResponseOnce({
      content: [
        { type: 'text', text: 'Yes — the villa is on the market. Maria can show it Tue/Thu/Sat.' },
      ],
      stop_reason: 'end_turn',
      usage: { input_tokens: 800, output_tokens: 50 },
    });

    const out = await scheduleDraft({
      supabase: client,
      conversationId: CONV_ID,
      agentId: AGENT_ID,
      orgId: ORG_ID,
    });

    expect(out.ok).toBe(true);
    expect(out.errorCode).toBeUndefined();
    expect(out.messageId).toBe('msg-generated-12345');

    // Assistant insert payload — confidence, intent, risk_flags, status
    const inserted = inserts.get('ai_conversation_messages')?.[0] as Record<
      string,
      unknown
    >;
    expect(inserted).toBeDefined();
    expect(inserted.conversation_id).toBe(CONV_ID);
    expect(inserted.role).toBe('assistant');
    expect(inserted.channel).toBe('email');
    expect(inserted.body).toMatch(/villa is on the market/);
    expect(inserted.approval_status).toBe('pending');
    // 'availability' intent → confidence 0.95 (safe high-confidence bucket).
    expect(inserted.intent).toBe('availability');
    expect(typeof inserted.confidence).toBe('number');
    expect(inserted.confidence).toBeGreaterThanOrEqual(0.9);
    expect(Array.isArray(inserted.risk_flags)).toBe(true);
    // No risk flags expected for a benign availability question.
    expect((inserted.risk_flags as string[]).length).toBe(0);
    // 'pending' means no sent_at is written.
    expect(inserted.sent_at).toBeUndefined();

    // Conversation last_message_at bump
    const bump = updates.get('ai_conversations')?.[0] as Record<string, unknown>;
    expect(bump).toBeDefined();
    expect(typeof bump.last_message_at).toBe('string');
  });
});

describe('scheduleDraft — Anthropic failure', () => {
  it('returns errorCode and DOES NOT throw when Anthropic 5xxs', async () => {
    const { client, setTableResponses, inserts } = makeFakeSupabase();
    // DESC order — matches the helper's .order('created_at', { ascending: false })
    const priorMessages = [
      { role: 'user', body: 'Is the villa still available?', created_at: '2026-05-18T00:00:00Z' },
    ];
    stageHappyPathReads(setTableResponses, priorMessages);
    mockAnthropicResponseOnce({ error: 'server_error' }, 500);

    let threw = false;
    let out: Awaited<ReturnType<typeof scheduleDraft>> | null = null;
    try {
      out = await scheduleDraft({
        supabase: client,
        conversationId: CONV_ID,
        agentId: AGENT_ID,
        orgId: ORG_ID,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(out).not.toBeNull();
    expect(out!.ok).toBe(false);
    expect(out!.errorCode).toMatch(/^anthropic_/);
    expect(inserts.get('ai_conversation_messages')).toBeUndefined();
  });
});

describe('scheduleDraft — multi-turn history', () => {
  it('classifies against the LAST user turn when prior turns alternate [user, assistant, user, assistant, user]', async () => {
    const { client, setTableResponses, inserts } = makeFakeSupabase();
    // Staged in DESCENDING created_at order — that's what supabase
    // returns when the helper calls .order('created_at', { ascending: false }).
    // After the helper's .slice().reverse(), chronological order is
    // [user1, asst1, user2, asst2, user3] with user3 (viewing-request)
    // being the latest user turn the classifier should pick up.
    const priorMessages = [
      // newest first
      { role: 'user', body: 'Can I schedule a tour next week?', created_at: '2026-05-18T00:04:00Z' },
      { role: 'assistant', body: 'second AI reply', created_at: '2026-05-18T00:03:00Z' },
      { role: 'user', body: 'unrelated middle message', created_at: '2026-05-18T00:02:00Z' },
      { role: 'assistant', body: 'first AI reply', created_at: '2026-05-18T00:01:00Z' },
      { role: 'user', body: 'first buyer question', created_at: '2026-05-18T00:00:00Z' },
    ];
    stageHappyPathReads(setTableResponses, priorMessages);

    mockAnthropicResponseOnce({
      content: [{ type: 'text', text: 'Sure — Maria can show it Tue or Thu at 10am. Want me to pencil one in?' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 40 },
    });

    const out = await scheduleDraft({
      supabase: client,
      conversationId: CONV_ID,
      agentId: AGENT_ID,
      orgId: ORG_ID,
    });

    expect(out.ok).toBe(true);
    const inserted = inserts.get('ai_conversation_messages')?.[0] as Record<
      string,
      unknown
    >;
    // The classifier intent should be derived from the LAST user turn
    // ("schedule a tour") — viewing-request — not from the first.
    expect(inserted.intent).toBe('viewing-request');
  });
});
