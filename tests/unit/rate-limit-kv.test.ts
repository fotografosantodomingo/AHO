import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * KV-backed fixed-window rate limiter for /api/leads.
 *
 * Test paths:
 *   - no KV binding (local dev / preview) → skipped, allowed
 *   - first request in a window → allowed, count starts at 1
 *   - request when count >= max → blocked with retry-after
 *   - separate identifiers don't share quota
 *   - separate namespaces don't share quota
 *   - window roll-over → key changes, fresh quota
 */

const mocks = vi.hoisted(() => ({
  getOptionalRequestContext: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@cloudflare/next-on-pages', () => ({
  getOptionalRequestContext: mocks.getOptionalRequestContext,
}));

interface FakeKV {
  store: Map<string, string>;
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>;
  putCalls: Array<{ key: string; value: string; ttl?: number }>;
}

function makeFakeKV(): FakeKV {
  const store = new Map<string, string>();
  const putCalls: FakeKV['putCalls'] = [];
  return {
    store,
    putCalls,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key, value, options) {
      store.set(key, value);
      putCalls.push({ key, value, ttl: options?.expirationTtl });
    },
  };
}

let nowSeconds = 1_700_000_000; // fixed clock — 2023-11-14T22:13:20Z

beforeEach(() => {
  mocks.getOptionalRequestContext.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(nowSeconds * 1000);
});

describe('checkRateLimit', () => {
  it('allows + reports skipped when no KV binding is attached', async () => {
    mocks.getOptionalRequestContext.mockReturnValue(undefined);
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    const result = await checkRateLimit('203.0.113.1', {
      namespace: 'leads',
      windowSeconds: 3600,
      max: 10,
    });
    expect(result).toEqual({ allowed: true, skipped: true });
  });

  it('allows the first request and stores count=1', async () => {
    const kv = makeFakeKV();
    mocks.getOptionalRequestContext.mockReturnValue({ env: { aho_rate_limit: kv } });
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    const result = await checkRateLimit('203.0.113.1', {
      namespace: 'leads',
      windowSeconds: 3600,
      max: 10,
    });
    expect(result).toEqual({ allowed: true, remaining: 9 });
    // Wait one tick for the fire-and-forget put to land.
    await vi.waitFor(() => expect(kv.putCalls.length).toBe(1));
    expect(kv.putCalls[0]?.value).toBe('1');
    expect(kv.putCalls[0]?.ttl).toBe(3600);
  });

  it('blocks once count reaches max and returns retry-after', async () => {
    const kv = makeFakeKV();
    mocks.getOptionalRequestContext.mockReturnValue({ env: { aho_rate_limit: kv } });
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    // Pre-seed the bucket to the limit. Window-start key matches the
    // helper's floor(now / window) computation.
    const windowStart = nowSeconds - (nowSeconds % 3600);
    kv.store.set(`rl:leads:203.0.113.1:${windowStart}`, '10');
    const result = await checkRateLimit('203.0.113.1', {
      namespace: 'leads',
      windowSeconds: 3600,
      max: 10,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed && !('skipped' in result)) {
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(3600);
    }
  });

  it('separate identifiers do not share quota', async () => {
    const kv = makeFakeKV();
    mocks.getOptionalRequestContext.mockReturnValue({ env: { aho_rate_limit: kv } });
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    const windowStart = nowSeconds - (nowSeconds % 3600);
    kv.store.set(`rl:leads:203.0.113.1:${windowStart}`, '10');
    const result = await checkRateLimit('203.0.113.99', {
      namespace: 'leads',
      windowSeconds: 3600,
      max: 10,
    });
    expect(result).toEqual({ allowed: true, remaining: 9 });
  });

  it('separate namespaces do not share quota', async () => {
    const kv = makeFakeKV();
    mocks.getOptionalRequestContext.mockReturnValue({ env: { aho_rate_limit: kv } });
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    const windowStart = nowSeconds - (nowSeconds % 3600);
    kv.store.set(`rl:leads:203.0.113.1:${windowStart}`, '10');
    const result = await checkRateLimit('203.0.113.1', {
      namespace: 'auth',
      windowSeconds: 3600,
      max: 10,
    });
    expect(result).toEqual({ allowed: true, remaining: 9 });
  });

  it('window roll-over starts a fresh quota', async () => {
    const kv = makeFakeKV();
    mocks.getOptionalRequestContext.mockReturnValue({ env: { aho_rate_limit: kv } });
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    const oldWindow = nowSeconds - (nowSeconds % 3600);
    kv.store.set(`rl:leads:203.0.113.1:${oldWindow}`, '10');
    // Advance to next window.
    vi.setSystemTime((nowSeconds + 3600) * 1000);
    const result = await checkRateLimit('203.0.113.1', {
      namespace: 'leads',
      windowSeconds: 3600,
      max: 10,
    });
    expect(result).toEqual({ allowed: true, remaining: 9 });
  });

  it('uses ctx.waitUntil when available so the put is guaranteed to flush', async () => {
    const kv = makeFakeKV();
    const waitUntil = vi.fn();
    mocks.getOptionalRequestContext.mockReturnValue({
      env: { aho_rate_limit: kv },
      ctx: { waitUntil },
    });
    const { checkRateLimit } = await import('@/lib/rate-limit/kv');
    await checkRateLimit('203.0.113.1', {
      namespace: 'leads',
      windowSeconds: 3600,
      max: 10,
    });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
