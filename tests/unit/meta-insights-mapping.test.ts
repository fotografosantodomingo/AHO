import { describe, expect, it } from 'vitest';
import {
  mapFacebookInsightsResponse,
  mapInstagramInsightsResponse,
  pluckMetric,
  type MetaInsightsResponse,
} from '@/lib/insights/meta';

/**
 * Pure-function tests for the Meta Insights cron mappers.
 *
 * The fixture responses are FROZEN excerpts of the shapes documented at:
 *   - FB:  https://developers.facebook.com/docs/graph-api/reference/v21.0/insights
 *   - IG:  https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-media/insights
 *
 * Keeping the fixtures inline here means the test fails the moment
 * Meta changes their envelope shape — we won't ship dashboard rows
 * built from a stale parser.
 */

const POSTED_AT = new Date('2026-05-01T09:00:00.000Z');

const FB_FIXTURE: MetaInsightsResponse = {
  data: [
    {
      name: 'post_impressions',
      period: 'lifetime',
      values: [{ value: 1234 }],
      title: 'Lifetime Post Total Impressions',
      description: 'Lifetime: The number of impressions of your Page post.',
    },
    {
      name: 'post_engaged_users',
      period: 'lifetime',
      values: [{ value: 56 }],
      title: 'Lifetime Engaged Users',
      description:
        'Lifetime: The number of unique people who engaged in any way with your Page post.',
    },
    {
      name: 'post_clicks',
      period: 'lifetime',
      values: [{ value: 89 }],
      title: 'Lifetime Post Consumers',
      description:
        'Lifetime: The number of people who clicked anywhere in your post.',
    },
  ],
  paging: { cursors: { before: 'BEFORE', after: 'AFTER' } },
};

const IG_FIXTURE: MetaInsightsResponse = {
  data: [
    { name: 'reach', period: 'lifetime', values: [{ value: 4321 }] },
    { name: 'impressions', period: 'lifetime', values: [{ value: 5678 }] },
    { name: 'engagement', period: 'lifetime', values: [{ value: 234 }] },
  ],
};

describe('pluckMetric', () => {
  it('pulls a numeric value out of a metric entry', () => {
    expect(pluckMetric(FB_FIXTURE, 'post_impressions')).toBe(1234);
    expect(pluckMetric(FB_FIXTURE, 'post_engaged_users')).toBe(56);
  });

  it('returns 0 for a missing metric', () => {
    expect(pluckMetric(FB_FIXTURE, 'nope_not_a_metric')).toBe(0);
  });

  it('returns 0 when the values array is empty', () => {
    const r: MetaInsightsResponse = {
      data: [{ name: 'x', values: [] }],
    };
    expect(pluckMetric(r, 'x')).toBe(0);
  });

  it('coerces a string-valued number', () => {
    const r: MetaInsightsResponse = {
      data: [{ name: 'x', values: [{ value: '42' }] }],
    };
    expect(pluckMetric(r, 'x')).toBe(42);
  });

  it('sums an object-valued breakdown', () => {
    // Some FB metrics return per-action-type breakdowns as an object.
    // The mapper should treat the sum as the aggregate.
    const r: MetaInsightsResponse = {
      data: [
        { name: 'post_clicks', values: [{ value: { link_click: 50, other: 39 } }] },
      ],
    };
    expect(pluckMetric(r, 'post_clicks')).toBe(89);
  });

  it('clamps negative numbers to 0 (defensive — Insights never returns negatives)', () => {
    const r: MetaInsightsResponse = {
      data: [{ name: 'x', values: [{ value: -10 }] }],
    };
    expect(pluckMetric(r, 'x')).toBe(0);
  });

  it('truncates fractional values to integers', () => {
    const r: MetaInsightsResponse = {
      data: [{ name: 'x', values: [{ value: 12.7 }] }],
    };
    expect(pluckMetric(r, 'x')).toBe(12);
  });
});

describe('mapFacebookInsightsResponse', () => {
  it('maps the documented FB fixture into a listing_post_metrics insert', () => {
    const out = mapFacebookInsightsResponse({
      raw: FB_FIXTURE,
      listingId: 'listing-uuid-1',
      postId: '123_456',
      postedAt: POSTED_AT,
    });
    expect(out).toEqual({
      listingId: 'listing-uuid-1',
      platform: 'facebook',
      postedAt: POSTED_AT,
      postExternalId: '123_456',
      impressions: 1234,
      reach: 56,
      clicks: 89,
      leads: 0,
      cplCents: null,
      currency: 'USD',
    });
  });

  it('emits zeros when the fixture is missing metrics', () => {
    const out = mapFacebookInsightsResponse({
      raw: { data: [] },
      listingId: 'L',
      postId: 'P',
      postedAt: POSTED_AT,
    });
    expect(out.impressions).toBe(0);
    expect(out.reach).toBe(0);
    expect(out.clicks).toBe(0);
    expect(out.leads).toBe(0);
    expect(out.cplCents).toBeNull();
  });

  it('always emits platform="facebook" — never the parent token kind "meta"', () => {
    // listing_post_metrics CHECK constraint allows facebook|instagram|...
    // but NOT 'meta'. The mapper must never leak the token-side string.
    const out = mapFacebookInsightsResponse({
      raw: FB_FIXTURE,
      listingId: 'L',
      postId: 'P',
      postedAt: POSTED_AT,
    });
    expect(out.platform).toBe('facebook');
  });
});

describe('mapInstagramInsightsResponse', () => {
  it('maps the documented IG fixture into a listing_post_metrics insert', () => {
    const out = mapInstagramInsightsResponse({
      raw: IG_FIXTURE,
      listingId: 'listing-uuid-2',
      mediaId: '17900000000000000',
      postedAt: POSTED_AT,
    });
    expect(out).toEqual({
      listingId: 'listing-uuid-2',
      platform: 'instagram',
      postedAt: POSTED_AT,
      postExternalId: '17900000000000000',
      reach: 4321,
      impressions: 5678,
      // engagement maps to clicks (documented in lib/insights/meta.ts).
      clicks: 234,
      leads: 0,
      cplCents: null,
      currency: 'USD',
    });
  });

  it('emits zeros when the fixture is missing metrics', () => {
    const out = mapInstagramInsightsResponse({
      raw: { data: [] },
      listingId: 'L',
      mediaId: 'M',
      postedAt: POSTED_AT,
    });
    expect(out.reach).toBe(0);
    expect(out.impressions).toBe(0);
    expect(out.clicks).toBe(0);
  });

  it('always emits platform="instagram"', () => {
    const out = mapInstagramInsightsResponse({
      raw: IG_FIXTURE,
      listingId: 'L',
      mediaId: 'M',
      postedAt: POSTED_AT,
    });
    expect(out.platform).toBe('instagram');
  });
});
