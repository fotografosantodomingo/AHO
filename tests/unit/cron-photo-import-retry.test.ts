import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Tests for the hourly photo-import dead-letter retry cron
 * (POST /api/cron/photo-import-retry).
 *
 * Two surfaces:
 *   - planRetryActions — pure decision matrix, no mocks needed.
 *   - POST handler auth gate — bearer-token check; needs the env
 *     module + admin-client module mocked because they pull in
 *     server-only dependencies that don't exist in Node-side tests.
 *
 * The pipeline-level success path is exercised end-to-end by the
 * existing import-photos route tests; duplicating that here would
 * require mocking R2 + CF Images + Supabase, none of which the
 * cron adds new behavior on top of.
 */

const mocks = vi.hoisted(() => ({
  serverEnv: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  serverEnv: mocks.serverEnv,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
// Pipeline import would chain through to R2 / supabase clients;
// the auth-gate tests never reach it, but module evaluation does.
vi.mock('@/lib/listings/photo-import-pipeline', () => ({
  importOne: vi.fn(),
}));

beforeEach(() => {
  mocks.serverEnv.mockReset();
  mocks.createAdminClient.mockReset();
});

describe('planRetryActions', () => {
  // 2026-05-08T12:00:00Z — pinned epoch so the cooldown math is
  // deterministic regardless of when CI runs.
  const NOW = new Date('2026-05-08T12:00:00.000Z');
  const COOLDOWN_MS = 15 * 60_000;
  const MAX = 5;

  function row(overrides: Partial<{
    id: string;
    property_id: string;
    source_url: string;
    attempts: number;
    last_failed_at: string;
  }> = {}) {
    return {
      id: 'row-1',
      property_id: 'prop-1',
      source_url: 'https://cdn.example.com/a.jpg',
      attempts: 1,
      // 30 minutes ago — well past the 15m cooldown.
      last_failed_at: '2026-05-08T11:30:00.000Z',
      ...overrides,
    };
  }

  it('marks rows at or above the give-up threshold as skip_gave_up', async () => {
    const { planRetryActions } = await import(
      '@/app/api/cron/photo-import-retry/route'
    );
    const actions = planRetryActions({
      rows: [
        row({ id: 'r-just-below', attempts: 4 }),
        row({ id: 'r-at-threshold', attempts: 5 }),
        row({ id: 'r-over', attempts: 99 }),
      ],
      now: NOW,
      maxAttempts: MAX,
      cooldownMs: COOLDOWN_MS,
    });
    expect(actions[0]?.kind).toBe('retry');
    expect(actions[1]).toEqual({ kind: 'skip_gave_up', rowId: 'r-at-threshold' });
    expect(actions[2]).toEqual({ kind: 'skip_gave_up', rowId: 'r-over' });
  });

  it('marks recent failures as skip_cooldown', async () => {
    const { planRetryActions } = await import(
      '@/app/api/cron/photo-import-retry/route'
    );
    const actions = planRetryActions({
      rows: [
        // 5 minutes ago — within the 15m cooldown.
        row({ id: 'r-recent', last_failed_at: '2026-05-08T11:55:00.000Z' }),
        // exactly at the cutoff (15m ago) — should retry, not cooldown.
        row({ id: 'r-edge', last_failed_at: '2026-05-08T11:45:00.000Z' }),
        // Way past cooldown.
        row({ id: 'r-old', last_failed_at: '2026-05-08T10:00:00.000Z' }),
      ],
      now: NOW,
      maxAttempts: MAX,
      cooldownMs: COOLDOWN_MS,
    });
    expect(actions[0]).toEqual({ kind: 'skip_cooldown', rowId: 'r-recent' });
    expect(actions[1]?.kind).toBe('retry');
    expect(actions[2]?.kind).toBe('retry');
  });

  it('returns retry actions carrying the property + URL for callable rows', async () => {
    const { planRetryActions } = await import(
      '@/app/api/cron/photo-import-retry/route'
    );
    const actions = planRetryActions({
      rows: [
        row({
          id: 'row-x',
          property_id: 'prop-x',
          source_url: 'https://cdn.example.com/photo.png',
          attempts: 2,
        }),
      ],
      now: NOW,
      maxAttempts: MAX,
      cooldownMs: COOLDOWN_MS,
    });
    expect(actions).toEqual([
      {
        kind: 'retry',
        rowId: 'row-x',
        propertyId: 'prop-x',
        sourceUrl: 'https://cdn.example.com/photo.png',
      },
    ]);
  });

  it('treats unparseable last_failed_at as past-cooldown (retries)', async () => {
    const { planRetryActions } = await import(
      '@/app/api/cron/photo-import-retry/route'
    );
    const actions = planRetryActions({
      rows: [row({ id: 'r-bad', last_failed_at: 'not-a-date' })],
      now: NOW,
      maxAttempts: MAX,
      cooldownMs: COOLDOWN_MS,
    });
    // Don't strand a row in the queue forever just because its
    // timestamp is malformed; retrying is the safer default.
    expect(actions[0]?.kind).toBe('retry');
  });
});

describe('POST /api/cron/photo-import-retry — auth gate', () => {
  function makeReq(headers: Record<string, string> = {}): Request {
    // Minimal Request shape the route uses: .headers.get('authorization').
    return new Request('https://example.com/api/cron/photo-import-retry', {
      method: 'POST',
      headers,
    });
  }

  it('returns 401 when CRON_SECRET is not configured', async () => {
    mocks.serverEnv.mockReturnValue({});
    const { POST } = await import('@/app/api/cron/photo-import-retry/route');
    // The route signature uses NextRequest; the runtime check is on
    // .headers.get(), which Request implements identically.
    const res = await POST(makeReq({ authorization: 'Bearer anything' }) as never);
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { POST } = await import('@/app/api/cron/photo-import-retry/route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token does not match', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { POST } = await import('@/app/api/cron/photo-import-retry/route');
    const res = await POST(
      makeReq({ authorization: 'Bearer ' + 'b'.repeat(64) }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 401 for a non-Bearer scheme even with the right token', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { POST } = await import('@/app/api/cron/photo-import-retry/route');
    const res = await POST(
      makeReq({ authorization: 'Basic ' + 'a'.repeat(64) }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
