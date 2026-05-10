import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Tests for the daily post-sale review-request cron
 * (POST /api/cron/review-requests).
 *
 * Two surfaces under test:
 *   - filterEligibleListings — pure decision matrix that picks which
 *     sold-listing rows the cron should email about. Frozen `now` +
 *     fixture sales at various ages assert the inclusive 14–90 day
 *     window plus the status / already-sent filters.
 *   - POST handler auth gate — bearer-token check returning 401 for
 *     missing config, missing header, wrong bearer, and wrong scheme.
 *
 * The end-to-end happy path (Brevo send + property stamp) is exercised
 * by the route's runtime behaviour — duplicating it here would mean
 * mocking Supabase, Brevo, and the email template without adding
 * coverage on top of `findBuyerLead` / `findAgentDisplayName` (both
 * trivial pass-throughs to the supabase client).
 */

const mocks = vi.hoisted(() => ({
  serverEnv: vi.fn(),
  publicEnv: vi.fn(),
  createAdminClient: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({
  serverEnv: mocks.serverEnv,
  publicEnv: mocks.publicEnv,
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock('@/lib/email/brevo', () => ({
  sendEmail: mocks.sendEmail,
}));

beforeEach(() => {
  mocks.serverEnv.mockReset();
  mocks.publicEnv.mockReset();
  mocks.createAdminClient.mockReset();
  mocks.sendEmail.mockReset();
});

describe('filterEligibleListings', () => {
  // 2026-05-09T00:00:00Z — pinned epoch so all the `daysAgo` math is
  // deterministic regardless of when CI runs.
  const NOW = new Date('2026-05-09T00:00:00.000Z');

  function daysAgo(days: number): string {
    return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  function row(
    overrides: Partial<{
      id: string;
      short_id: string;
      org_id: string;
      status: string;
      sold_date: string;
      review_request_sent_at: string | null;
      title_en: string | null;
      title_es: string | null;
      city: string | null;
    }> = {},
  ) {
    return {
      id: 'prop-1',
      short_id: 'AHO-001',
      org_id: 'org-1',
      status: 'sold',
      sold_date: daysAgo(30), // squarely inside the window
      review_request_sent_at: null,
      title_en: 'Sample title',
      title_es: 'Titulo de muestra',
      city: 'Santo Domingo',
      ...overrides,
    };
  }

  it('keeps a sold listing whose sold_date sits squarely in the 14–90 day window', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [row({ id: 'prop-30', sold_date: daysAgo(30) })],
      now: NOW,
    });
    expect(eligible).toHaveLength(1);
    expect(eligible[0]?.id).toBe('prop-30');
  });

  it('drops sales younger than 14 days (still in cool-off window)', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [
        row({ id: 'prop-2d', sold_date: daysAgo(2) }),
        row({ id: 'prop-13d', sold_date: daysAgo(13) }),
      ],
      now: NOW,
    });
    expect(eligible).toHaveLength(0);
  });

  it('drops sales older than 90 days (too late, churn risk)', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [
        row({ id: 'prop-91d', sold_date: daysAgo(91) }),
        row({ id: 'prop-365d', sold_date: daysAgo(365) }),
      ],
      now: NOW,
    });
    expect(eligible).toHaveLength(0);
  });

  it('keeps the inclusive boundary edges (14 days exactly + 90 days exactly)', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [
        row({ id: 'prop-edge-14', sold_date: daysAgo(14) }),
        row({ id: 'prop-edge-90', sold_date: daysAgo(90) }),
      ],
      now: NOW,
    });
    expect(eligible.map((r) => r.id).sort()).toEqual([
      'prop-edge-14',
      'prop-edge-90',
    ]);
  });

  it('drops listings whose status is not sold, regardless of sold_date', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [
        row({ id: 'prop-active', status: 'active', sold_date: daysAgo(30) }),
        row({ id: 'prop-rented', status: 'rented', sold_date: daysAgo(30) }),
        row({ id: 'prop-archived', status: 'archived', sold_date: daysAgo(30) }),
      ],
      now: NOW,
    });
    expect(eligible).toHaveLength(0);
  });

  it('drops listings that already have review_request_sent_at stamped', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [
        row({
          id: 'prop-already-sent',
          sold_date: daysAgo(30),
          review_request_sent_at: daysAgo(5),
        }),
      ],
      now: NOW,
    });
    expect(eligible).toHaveLength(0);
  });

  it('drops listings with an unparseable sold_date rather than fabricating one', async () => {
    const { filterEligibleListings } = await import(
      '@/app/api/cron/review-requests/route'
    );
    const eligible = filterEligibleListings({
      rows: [row({ id: 'prop-bad', sold_date: 'not-a-date' })],
      now: NOW,
    });
    // Unlike the photo-import-retry cron's "treat bad timestamp as
    // past-cooldown so we still try", here we'd rather drop the row.
    // A malformed sold_date is a data-integrity issue worth surfacing
    // to the agent (via UI), not silently emailing the buyer about.
    expect(eligible).toHaveLength(0);
  });
});

describe('POST /api/cron/review-requests — auth gate', () => {
  function makeReq(headers: Record<string, string> = {}): Request {
    return new Request('https://example.com/api/cron/review-requests', {
      method: 'POST',
      headers,
    });
  }

  it('returns 401 when CRON_SECRET is not configured', async () => {
    mocks.serverEnv.mockReturnValue({});
    const { POST } = await import('@/app/api/cron/review-requests/route');
    const res = await POST(makeReq({ authorization: 'Bearer anything' }) as never);
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing entirely', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { POST } = await import('@/app/api/cron/review-requests/route');
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('returns 401 when the Bearer token does not match', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { POST } = await import('@/app/api/cron/review-requests/route');
    const res = await POST(
      makeReq({ authorization: 'Bearer ' + 'b'.repeat(64) }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('returns 401 for a non-Bearer scheme even with the right token value', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { POST } = await import('@/app/api/cron/review-requests/route');
    const res = await POST(
      makeReq({ authorization: 'Basic ' + 'a'.repeat(64) }) as never,
    );
    expect(res.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('GET delegates to the same auth gate and 401s on a missing bearer', async () => {
    mocks.serverEnv.mockReturnValue({ CRON_SECRET: 'a'.repeat(64) });
    const { GET } = await import('@/app/api/cron/review-requests/route');
    const res = await GET(
      new Request('https://example.com/api/cron/review-requests') as never,
    );
    expect(res.status).toBe(401);
  });
});
