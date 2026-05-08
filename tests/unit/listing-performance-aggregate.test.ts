import { describe, it, expect } from 'vitest';
import {
  aggregatePerformance,
  type ListingPostMetricRow,
} from '@/lib/listings/listing-performance';

/**
 * Pure aggregator behind the Sprint 3 "Social performance" tab on
 * /dashboard/analytics/[id]. The page renders empty today (no rows
 * in `listing_post_metrics` until the Meta Insights cron + FB Lead
 * Ads webhook ship), so the empty-state branch is the most-exercised
 * production path. The populated paths are pre-tested here so that
 * when the writers DO start populating snapshots, the dashboard
 * lights up correctly without further code changes.
 */

const FROZEN_NOW = new Date('2026-05-15T12:00:00.000Z');

function row(o: Partial<ListingPostMetricRow>): ListingPostMetricRow {
  return {
    id: o.id ?? 'metric-1',
    listingId: o.listingId ?? 'listing-1',
    platform: o.platform ?? 'facebook',
    postedAt: o.postedAt ?? '2026-05-10T09:00:00.000Z',
    postExternalId: o.postExternalId ?? 'fb-post-1',
    reach: o.reach ?? 0,
    impressions: o.impressions ?? 0,
    clicks: o.clicks ?? 0,
    leads: o.leads ?? 0,
    cplCents: o.cplCents ?? null,
    currency: o.currency ?? 'USD',
    capturedAt: o.capturedAt ?? '2026-05-15T10:00:00.000Z',
  };
}

describe('aggregatePerformance', () => {
  it('returns isEmpty=true with a 30-day zero sparkline on no rows', () => {
    const r = aggregatePerformance([], FROZEN_NOW);
    expect(r.isEmpty).toBe(true);
    expect(r.perPlatform).toEqual([]);
    expect(r.recentPosts).toEqual([]);
    expect(r.sparkline30d).toHaveLength(30);
    expect(r.sparkline30d.every((p) => p.reach === 0)).toBe(true);
    // Newest day in the window is FROZEN_NOW's UTC date.
    expect(r.sparkline30d[r.sparkline30d.length - 1]!.day).toBe('2026-05-15');
    expect(r.sparkline30d[0]!.day).toBe('2026-04-16');
  });

  it('keeps only the LATEST snapshot per (platform, postExternalId) for tile sums', () => {
    // Same FB post, two snapshots — the cumulative counter grew. We
    // must NOT double-count.
    const rows = [
      row({
        id: 'a',
        platform: 'facebook',
        postExternalId: 'fb-A',
        reach: 100,
        leads: 1,
        capturedAt: '2026-05-13T10:00:00.000Z',
      }),
      row({
        id: 'b',
        platform: 'facebook',
        postExternalId: 'fb-A',
        reach: 250,
        leads: 3,
        capturedAt: '2026-05-15T10:00:00.000Z',
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.isEmpty).toBe(false);
    expect(r.perPlatform).toHaveLength(1);
    const fb = r.perPlatform[0]!;
    expect(fb.platform).toBe('facebook');
    expect(fb.totalReach).toBe(250);
    expect(fb.totalLeads).toBe(3);
    expect(fb.postCount).toBe(1);
    expect(r.recentPosts).toHaveLength(1);
    expect(r.recentPosts[0]!.reach).toBe(250);
  });

  it('sums latest snapshots ACROSS posts on the same platform', () => {
    const rows = [
      row({
        platform: 'facebook',
        postExternalId: 'fb-A',
        reach: 200,
        leads: 2,
      }),
      row({
        platform: 'facebook',
        postExternalId: 'fb-B',
        reach: 50,
        leads: 0,
        postedAt: '2026-05-12T09:00:00.000Z',
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    const fb = r.perPlatform.find((t) => t.platform === 'facebook');
    expect(fb?.totalReach).toBe(250);
    expect(fb?.totalLeads).toBe(2);
    expect(fb?.postCount).toBe(2);
  });

  it('separates platforms — FB and IG get distinct tiles', () => {
    const rows = [
      row({
        platform: 'facebook',
        postExternalId: 'fb-1',
        reach: 100,
        leads: 1,
      }),
      row({
        platform: 'instagram',
        postExternalId: 'ig-1',
        reach: 400,
        leads: 5,
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.perPlatform).toHaveLength(2);
    // Sorted by reach desc — IG first.
    expect(r.perPlatform[0]!.platform).toBe('instagram');
    expect(r.perPlatform[1]!.platform).toBe('facebook');
    expect(r.perPlatform[0]!.totalReach).toBe(400);
    expect(r.perPlatform[1]!.totalReach).toBe(100);
  });

  it('averages CPL across posts that have spend; null when none do', () => {
    const rows = [
      row({
        platform: 'facebook',
        postExternalId: 'fb-1',
        reach: 100,
        leads: 1,
        cplCents: 500, // $5.00
        currency: 'USD',
      }),
      row({
        platform: 'facebook',
        postExternalId: 'fb-2',
        reach: 200,
        leads: 1,
        cplCents: 700, // $7.00
        currency: 'USD',
      }),
      row({
        platform: 'instagram',
        postExternalId: 'ig-organic',
        reach: 50,
        leads: 0,
        cplCents: null, // organic
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    const fb = r.perPlatform.find((t) => t.platform === 'facebook');
    const ig = r.perPlatform.find((t) => t.platform === 'instagram');
    expect(fb?.avgCplCents).toBe(600); // (500 + 700) / 2
    expect(fb?.cplCurrency).toBe('USD');
    expect(ig?.avgCplCents).toBeNull();
  });

  it('lastPostedAt = max posted_at across the platform', () => {
    const rows = [
      row({
        platform: 'facebook',
        postExternalId: 'fb-old',
        postedAt: '2026-05-01T09:00:00.000Z',
      }),
      row({
        platform: 'facebook',
        postExternalId: 'fb-new',
        postedAt: '2026-05-12T09:00:00.000Z',
      }),
      row({
        platform: 'facebook',
        postExternalId: 'fb-mid',
        postedAt: '2026-05-08T09:00:00.000Z',
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.perPlatform[0]!.lastPostedAt).toBe('2026-05-12T09:00:00.000Z');
  });

  it('recentPosts is sorted by posted_at desc', () => {
    const rows = [
      row({
        platform: 'facebook',
        postExternalId: 'fb-old',
        postedAt: '2026-05-01T09:00:00.000Z',
      }),
      row({
        platform: 'instagram',
        postExternalId: 'ig-new',
        postedAt: '2026-05-14T09:00:00.000Z',
      }),
      row({
        platform: 'facebook',
        postExternalId: 'fb-mid',
        postedAt: '2026-05-08T09:00:00.000Z',
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.recentPosts.map((p) => p.postExternalId)).toEqual([
      'ig-new',
      'fb-mid',
      'fb-old',
    ]);
  });

  it('sparkline buckets reach by UTC day across all snapshots in the window', () => {
    const rows = [
      // Captured on 2026-05-10 — inside window.
      row({
        platform: 'facebook',
        postExternalId: 'fb-1',
        reach: 100,
        capturedAt: '2026-05-10T08:00:00.000Z',
      }),
      // Captured on 2026-05-15 — newest day.
      row({
        platform: 'facebook',
        postExternalId: 'fb-1',
        reach: 250,
        capturedAt: '2026-05-15T10:00:00.000Z',
      }),
      // Same day, different post — should sum.
      row({
        platform: 'instagram',
        postExternalId: 'ig-1',
        reach: 50,
        capturedAt: '2026-05-15T11:00:00.000Z',
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    const may10 = r.sparkline30d.find((p) => p.day === '2026-05-10');
    const may15 = r.sparkline30d.find((p) => p.day === '2026-05-15');
    expect(may10?.reach).toBe(100);
    expect(may15?.reach).toBe(300);
  });

  it('drops snapshots whose captured_at is outside the 30-day window from the sparkline', () => {
    const rows = [
      // 60 days before FROZEN_NOW — outside window.
      row({
        platform: 'facebook',
        postExternalId: 'fb-old',
        reach: 9999,
        capturedAt: '2026-03-15T10:00:00.000Z',
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.sparkline30d.every((p) => p.reach === 0)).toBe(true);
  });

  it('rejects unknown platforms and treats the result as empty (defensive — schema CHECK should prevent this)', () => {
    const rows = [
      // Cast since the type does not allow this; simulating a corrupt row.
      {
        ...row({ reach: 999 }),
        platform: 'myspace' as unknown as ListingPostMetricRow['platform'],
      },
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.isEmpty).toBe(true);
    expect(r.perPlatform).toEqual([]);
    expect(r.recentPosts).toEqual([]);
    expect(r.sparkline30d).toHaveLength(30);
  });

  it('zero-reach populated case still yields an isEmpty=false result + sparkline of zeros', () => {
    // Edge case: snapshot rows exist but all-zero reach (post just
    // went live, no impressions yet). The dashboard should NOT show
    // the empty state — there ARE posts; they just haven't been seen.
    const rows = [
      row({
        platform: 'facebook',
        postExternalId: 'fb-fresh',
        reach: 0,
        leads: 0,
      }),
    ];
    const r = aggregatePerformance(rows, FROZEN_NOW);
    expect(r.isEmpty).toBe(false);
    expect(r.perPlatform).toHaveLength(1);
    expect(r.perPlatform[0]!.totalReach).toBe(0);
    expect(r.recentPosts).toHaveLength(1);
  });
});
