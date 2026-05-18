/**
 * Tests for `src/lib/ai/knowledge.ts` — the RLS-isolated knowledge fetcher
 * powering the per-agent AI customer-service persona.
 *
 * Mocks supabase via a hand-written chain stub. Per CLAUDE.md, supabase-js
 * returns errors as `{ data, error }` rather than throwing, so the stub
 * matches that shape exactly. Each test stages a programmable response per
 * (table, terminator) pair and asserts both the returned KnowledgeContext
 * AND that error cases degrade to an empty-state context rather than throw.
 */

import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { fetchKnowledge } from '@/lib/ai/knowledge';
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Fake supabase client ──────────────────────────────────────────────
//
// Each .from(table) call returns a chainable QueryBuilder. The chain
// accumulates state (filters, ordering, limits, single-vs-list) and resolves
// to whatever the test staged via `setTableResponse(table, …)`. The order of
// chainable methods doesn't matter; what matters is the FINAL terminator —
// maybeSingle() vs await (list) vs the count metadata.
//
// We also let the stub return different responses for the SAME table across
// sequential calls (the reviews table is queried twice — aggregate + top
// review). The `responses` array is consumed left-to-right.

interface StubResponse {
  data: unknown;
  error: { code?: string; message?: string; details?: string; hint?: string } | null;
  count?: number;
}

type ResponseQueue = StubResponse[];

class FakeQueryBuilder {
  private terminated = false;

  constructor(
    private readonly table: string,
    private readonly responses: Map<string, ResponseQueue>,
    private readonly calls: Array<{ table: string; chain: string[] }>,
    private readonly trace: string[] = [],
  ) {}

  private record(method: string, ...args: unknown[]): this {
    this.trace.push(`${method}(${args.length})`);
    return this;
  }

  select(_cols?: string, _opts?: { count?: 'exact'; head?: boolean }) {
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
        `[FakeSupabase] No staged response for table='${this.table}'. Trace: ${this.trace.join(' → ')}`,
      );
    }
    return queue.shift()!;
  }

  maybeSingle<T = unknown>(): Promise<{
    data: T | null;
    error: StubResponse['error'];
  }> {
    this.terminated = true;
    this.calls.push({ table: this.table, chain: [...this.trace, 'maybeSingle'] });
    const r = this.resolve();
    return Promise.resolve({ data: (r.data as T | null) ?? null, error: r.error });
  }

  // List-mode terminator: awaiting the builder itself.
  then<TResolved = unknown>(
    onFulfilled: (value: {
      data: unknown[] | null;
      error: StubResponse['error'];
      count?: number;
    }) => TResolved,
    onRejected?: (reason: unknown) => TResolved,
  ): Promise<TResolved> {
    this.terminated = true;
    this.calls.push({ table: this.table, chain: [...this.trace, 'await'] });
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
  const calls: Array<{ table: string; chain: string[] }> = [];

  function setTableResponses(table: string, list: StubResponse[]): void {
    responses.set(table, [...list]);
  }

  const client = {
    from(table: string) {
      return new FakeQueryBuilder(table, responses, calls);
    },
  } as unknown as SupabaseClient;

  return { client, setTableResponses, calls };
}

// ─── Common fixtures ──────────────────────────────────────────────────

const AGENT_ID = '00000000-0000-0000-0000-000000000001';
const ORG_ID = '00000000-0000-0000-0000-000000000002';
const LEAD_ID = '00000000-0000-0000-0000-000000000003';
const BUYER_USER_ID = '00000000-0000-0000-0000-000000000004';

const profile = {
  id: AGENT_ID,
  full_name: 'Maria Lopez',
  bio: 'Bilingual agent serving Santo Domingo since 2018.',
  specialties: ['Beachfront', 'Investment'],
  languages_spoken: ['en', 'es'],
};

const orgMembership = {
  org_id: ORG_ID,
  organizations: { id: ORG_ID, name: 'Lopez Realty', slug: 'lopez-realty' },
};

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-real-1',
    short_id: 'abc123',
    title_en: 'Modern 2BR loft',
    title_es: 'Loft moderno de 2 dormitorios',
    description_en: 'A bright loft near the Zona Colonial.',
    description_es: 'Un loft luminoso cerca de la Zona Colonial.',
    slug_en: 'modern-2br-loft',
    slug_es: 'loft-moderno-2dorm',
    property_type: 'apartment',
    transaction_type: 'sale',
    price_cents: 22_500_000,
    currency: 'USD',
    price_period: null,
    bedrooms: 2,
    bathrooms: '2.0',
    area_sqm: '95.5',
    city: 'Santo Domingo',
    country_code: 'DO',
    published_at: '2026-05-01T00:00:00Z',
    featured_until: null,
    ...overrides,
  };
}

// Reviews queue order: the impl builds two query chains. `topReviewQ` ends in
// `.maybeSingle()` which terminates synchronously at chain-construction time
// (consuming the first staged response), while `reviewsAggQ` has no terminator
// until `Promise.all` awaits it (consuming the second). So the test queue
// must stage [topReview, aggregate], NOT [aggregate, topReview].
function defaultEmptyResponses() {
  return {
    profiles: [{ data: profile, error: null }],
    organization_members: [{ data: orgMembership, error: null }],
    properties: [{ data: [], error: null }],
    agent_faqs: [{ data: [], error: null }],
    reviews: [
      { data: null, error: null }, // top review (maybeSingle, fires first)
      { data: [], error: null, count: 0 }, // aggregate (awaited, fires second)
    ],
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────

describe('fetchKnowledge — identity', () => {
  it('returns the agent identity + bio + languages + specialties', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const d = defaultEmptyResponses();
    setTableResponses('profiles', d.profiles);
    setTableResponses('organization_members', d.organization_members);
    setTableResponses('properties', d.properties);
    setTableResponses('agent_faqs', d.agent_faqs);
    setTableResponses('reviews', d.reviews);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.agent).toEqual({
      id: AGENT_ID,
      name: 'Maria Lopez',
      languages: ['en', 'es'],
      specialties: ['Beachfront', 'Investment'],
      bio: 'Bilingual agent serving Santo Domingo since 2018.',
    });
    expect(ctx.org.id).toBe(ORG_ID);
    expect(ctx.org.name).toBe('Lopez Realty');
  });
});

describe('fetchKnowledge — listings', () => {
  it('caps listings at 20 and sorts focusListingId first', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const rows = Array.from({ length: 25 }, (_, i) =>
      listingRow({ id: `listing-${i}`, short_id: `id${i.toString().padStart(4, '0')}` }),
    );
    // Pick one in the middle as the focus.
    const FOCUS = 'listing-12';
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [{ data: rows, error: null }]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      { data: null, error: null }, // top review (maybeSingle first)
      { data: [], error: null, count: 0 }, // aggregate (await second)
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
      focusListingId: FOCUS,
    });

    expect(ctx.listings).toHaveLength(20);
    expect(ctx.listings[0]?.id).toBe(FOCUS);
  });

  it('filters out test-fixture slug rows', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const rows = [
      listingRow({ id: 'real-1', short_id: 'r1abcd' }),
      listingRow({
        id: 'fixture-1',
        short_id: 'fix001',
        slug_en: 'aho-fixture-active-listing',
        slug_es: null,
      }),
      listingRow({
        id: 'fixture-2',
        short_id: 'fix002',
        slug_en: null,
        slug_es: 'aho-fixture-anuncio',
      }),
      listingRow({ id: 'real-2', short_id: 'r2abcd' }),
    ];
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [{ data: rows, error: null }]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      { data: null, error: null },
      { data: [], error: null, count: 0 },
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.listings.map((l) => l.id).sort()).toEqual(['real-1', 'real-2']);
  });

  it('returns empty listings array when the agent has none (soft-beta)', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const d = defaultEmptyResponses();
    setTableResponses('profiles', d.profiles);
    setTableResponses('organization_members', d.organization_members);
    setTableResponses('properties', d.properties);
    setTableResponses('agent_faqs', d.agent_faqs);
    setTableResponses('reviews', d.reviews);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.listings).toEqual([]);
  });
});

describe('fetchKnowledge — reviews', () => {
  it('returns count=0 + avg=0 + null snippet when there are no reviews', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const d = defaultEmptyResponses();
    setTableResponses('profiles', d.profiles);
    setTableResponses('organization_members', d.organization_members);
    setTableResponses('properties', d.properties);
    setTableResponses('agent_faqs', d.agent_faqs);
    setTableResponses('reviews', d.reviews);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.reviews).toEqual({ count: 0, avg: 0, recentTopReview: null });
  });

  it('returns count + avg + snippet when reviews exist', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [{ data: [], error: null }]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      // Top review (maybeSingle, terminator fires synchronously at chain
      // construction, so it consumes the queue first).
      {
        data: {
          rating: 5,
          body: 'Maria was fantastic. Helped us navigate every step of the purchase.',
          created_at: '2026-05-10T00:00:00Z',
        },
        error: null,
      },
      // Aggregate (awaited via Promise.all, fires second).
      {
        data: [{ rating: 5 }, { rating: 4 }, { rating: 5 }],
        error: null,
        count: 3,
      },
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.reviews.count).toBe(3);
    expect(ctx.reviews.avg).toBeCloseTo(4.67, 2);
    expect(ctx.reviews.recentTopReview).toMatch(/Maria was fantastic/);
  });
});

describe('fetchKnowledge — buyer / saved searches', () => {
  it('returns null buyer when leadId is not provided', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const d = defaultEmptyResponses();
    setTableResponses('profiles', d.profiles);
    setTableResponses('organization_members', d.organization_members);
    setTableResponses('properties', d.properties);
    setTableResponses('agent_faqs', d.agent_faqs);
    setTableResponses('reviews', d.reviews);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.buyer).toBeNull();
  });

  it('returns savedSearchesCount when leadId resolves to a user', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [{ data: [], error: null }]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      { data: null, error: null }, // top review (maybeSingle, fires first)
      { data: [], error: null, count: 0 }, // aggregate (await, fires second)
    ]);
    setTableResponses('leads', [{ data: { user_id: BUYER_USER_ID }, error: null }]);
    setTableResponses('saved_searches', [{ data: [], error: null, count: 4 }]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
      leadId: LEAD_ID,
    });

    expect(ctx.buyer).toEqual({ savedSearchesCount: 4 });
  });
});

describe('fetchKnowledge — locale fallbacks', () => {
  it('falls back EN → ES → "Listing" for the title when EN is missing', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    const rows = [
      // EN missing, ES present — buyerLocale=en should pull ES.
      listingRow({
        id: 'es-only',
        short_id: 'esonly',
        title_en: null,
        description_en: null,
      }),
      // Both missing — should fall back to 'Listing'.
      listingRow({
        id: 'no-title',
        short_id: 'notitl',
        title_en: null,
        title_es: null,
        description_en: null,
        description_es: null,
      }),
    ];
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [{ data: rows, error: null }]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      { data: null, error: null }, // top review (maybeSingle, fires first)
      { data: [], error: null, count: 0 }, // aggregate (await, fires second)
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    const esOnly = ctx.listings.find((l) => l.id === 'es-only');
    const noTitle = ctx.listings.find((l) => l.id === 'no-title');
    expect(esOnly?.title).toBe('Loft moderno de 2 dormitorios');
    expect(noTitle?.title).toBe('Listing');
  });
});

describe('fetchKnowledge — URL builder', () => {
  it('builds /es/propiedades/{slugEs}-{shortId} when buyerLocale === es', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [
      {
        data: [
          listingRow({
            id: 'l1',
            short_id: 'abc123',
            slug_en: 'modern-2br-loft',
            slug_es: 'loft-moderno-2dorm',
          }),
        ],
        error: null,
      },
    ]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      { data: null, error: null }, // top review (maybeSingle, fires first)
      { data: [], error: null, count: 0 }, // aggregate (await, fires second)
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'es',
    });

    expect(ctx.listings[0]?.url).toBe(
      'https://advertisehomes.online/es/propiedades/loft-moderno-2dorm-abc123',
    );
  });

  it('builds /en/properties/{slugEn}-{shortId} when buyerLocale === en', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);
    setTableResponses('properties', [
      {
        data: [
          listingRow({
            id: 'l1',
            short_id: 'abc123',
            slug_en: 'modern-2br-loft',
            slug_es: 'loft-moderno-2dorm',
          }),
        ],
        error: null,
      },
    ]);
    setTableResponses('agent_faqs', [{ data: [], error: null }]);
    setTableResponses('reviews', [
      { data: null, error: null }, // top review (maybeSingle, fires first)
      { data: [], error: null, count: 0 }, // aggregate (await, fires second)
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.listings[0]?.url).toBe(
      'https://advertisehomes.online/en/properties/modern-2br-loft-abc123',
    );
  });
});

describe('fetchKnowledge — error handling', () => {
  it('returns an empty-state context when the profile query errors', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [
      {
        data: null,
        error: { code: '42501', message: 'permission denied for table profiles' },
      },
    ]);
    setTableResponses('organization_members', [{ data: orgMembership, error: null }]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx).toEqual({
      agent: { id: AGENT_ID, name: '', languages: [], specialties: [], bio: null },
      org: { id: '', name: '', faqs: [] },
      listings: [],
      reviews: { count: 0, avg: 0, recentTopReview: null },
      buyer: null,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it('returns an empty-state context when the profile is missing', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [{ data: null, error: null }]);
    setTableResponses('organization_members', [{ data: null, error: null }]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.agent.name).toBe('');
    expect(ctx.listings).toEqual([]);
  });

  it('omits test-fixture orgs (slug starts with aho-test-org-)', async () => {
    const { client, setTableResponses } = makeFakeSupabase();
    setTableResponses('profiles', [{ data: profile, error: null }]);
    setTableResponses('organization_members', [
      {
        data: {
          org_id: ORG_ID,
          organizations: { id: ORG_ID, name: 'Fixture Org', slug: 'aho-test-org-xyz' },
        },
        error: null,
      },
    ]);

    const ctx = await fetchKnowledge({
      supabase: client,
      agentId: AGENT_ID,
      buyerLocale: 'en',
    });

    expect(ctx.org.name).toBe('');
    expect(ctx.listings).toEqual([]);
  });
});
