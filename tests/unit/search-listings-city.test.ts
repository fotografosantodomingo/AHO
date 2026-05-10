import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Regression test for QA-2026-05-10 P0 #1.
 *
 * `searchListings` previously called `query.eq('city', filters.city)` which
 * is case-sensitive at the Postgres level — a hero-search submission of
 * "Santo Domingo" would silently return zero results when the DB row was
 * saved as "santo domingo".
 *
 * The fix is to mirror `searchCityLanding` and use `.ilike('city', ...)`
 * (no wildcards = case-insensitive equality). This test captures the call
 * shape so a future regression to `.eq` would fail loudly.
 *
 * Strategy: stub `createServerSupabaseClient` with a chainable spy that
 * records every `.eq` / `.ilike` invocation, then assert the city filter
 * went through `.ilike`.
 */

const eqSpy = vi.fn();
const ilikeSpy = vi.fn();
const notSpy = vi.fn();
const orderSpy = vi.fn();
const rangeSpy = vi.fn();
const selectSpy = vi.fn();
const fromSpy = vi.fn();

function buildChain() {
  // Each method returns the chain so calls compose; the terminal `range`
  // resolves to a Supabase-shaped `{ data, error }` thenable.
  const chain: Record<string, unknown> = {
    select: selectSpy,
    eq: eqSpy,
    ilike: ilikeSpy,
    not: notSpy,
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    textSearch: vi.fn().mockReturnThis(),
    order: orderSpy,
    range: rangeSpy,
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
  };
  selectSpy.mockReturnValue(chain);
  eqSpy.mockReturnValue(chain);
  ilikeSpy.mockReturnValue(chain);
  notSpy.mockReturnValue(chain);
  orderSpy.mockReturnValue(chain);
  // The query is `await`ed at the end of the chain; the helper's last
  // call before that is `.range(...)`. Resolve to an empty result —
  // we're asserting on call shape, not on row mapping.
  rangeSpy.mockResolvedValue({ data: [], error: null });
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => {
    const chain = buildChain();
    fromSpy.mockReturnValue(chain);
    return { from: fromSpy };
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

import { searchListings, parseFilters } from '@/lib/listings/search';

describe('searchListings — city filter is case-insensitive', () => {
  beforeEach(() => {
    eqSpy.mockClear();
    ilikeSpy.mockClear();
    notSpy.mockClear();
    orderSpy.mockClear();
    rangeSpy.mockClear();
    selectSpy.mockClear();
    fromSpy.mockClear();
  });

  it('filters city with ilike (not eq) so casing differences still match', async () => {
    const filters = parseFilters({ city: 'Santo Domingo' });
    await searchListings(filters, 'en');

    // The bug: city was being passed to `.eq`, which is case-sensitive.
    // The fix: city must go through `.ilike`.
    const cityIlikeCall = ilikeSpy.mock.calls.find((c) => c[0] === 'city');
    expect(cityIlikeCall).toBeDefined();
    expect(cityIlikeCall?.[1]).toBe('Santo Domingo');

    // Defense in depth: city must NOT be passed to `.eq` (would silently
    // re-introduce the bug if someone added an `.eq('city', ...)` later).
    const cityEqCall = eqSpy.mock.calls.find((c) => c[0] === 'city');
    expect(cityEqCall).toBeUndefined();
  });

  it('does not call ilike for city when city filter is absent', async () => {
    const filters = parseFilters({});
    await searchListings(filters, 'en');

    const cityIlikeCall = ilikeSpy.mock.calls.find((c) => c[0] === 'city');
    expect(cityIlikeCall).toBeUndefined();
  });
});
