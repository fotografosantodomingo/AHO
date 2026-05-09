import { describe, expect, it } from 'vitest';
import {
  mapLinkedInResponseToMetric,
  type LinkedInShareStatisticElement,
} from '@/lib/insights/linkedin';

/**
 * Pure-mapper coverage for the LinkedIn insights writer.
 *
 * The mapper is the contract surface between LinkedIn's response shape
 * and our `listing_post_metrics` insert row. Any change to LinkedIn's
 * documented schema OR our table's column set should produce a
 * test failure here, not a silent runtime drift in production.
 *
 * AHO is NOT yet approved for LinkedIn Marketing API live access; these
 * fixtures match the documented response shape so the writer is
 * ready-to-light-up the day approval lands.
 */

const FROZEN_CAPTURED_AT = '2026-05-15T06:00:00.000Z';
const POSTED_AT = '2026-05-10T14:32:11.000Z';

describe('mapLinkedInResponseToMetric', () => {
  it('maps a populated statistics element to a fully-formed insert row', () => {
    const stats: LinkedInShareStatisticElement = {
      share: 'urn:li:share:7012345678901234567',
      totalShareStatistics: {
        clickCount: 42,
        commentCount: 3,
        engagement: 0.085,
        impressionCount: 1234,
        likeCount: 17,
        shareCount: 5,
        uniqueImpressionsCount: 980,
      },
    };

    const row = mapLinkedInResponseToMetric({
      listingId: 'listing-uuid-1',
      shareUrn: 'urn:li:share:7012345678901234567',
      postedAt: POSTED_AT,
      capturedAt: FROZEN_CAPTURED_AT,
      statistics: stats,
    });

    expect(row).toEqual({
      listing_id: 'listing-uuid-1',
      platform: 'linkedin',
      posted_at: POSTED_AT,
      post_external_id: 'urn:li:share:7012345678901234567',
      reach: 980,
      impressions: 1234,
      clicks: 42,
      leads: 0,
      cpl_cents: null,
      currency: 'USD',
      captured_at: FROZEN_CAPTURED_AT,
    });
  });

  it('zero-fills missing counter fields when LinkedIn omits them', () => {
    // LinkedIn returns sparse `totalShareStatistics` on shares younger
    // than ~2h. The writer still inserts a snapshot row so the time
    // series is unbroken; the next day's run picks up real numbers.
    const stats: LinkedInShareStatisticElement = {
      share: 'urn:li:share:1',
      totalShareStatistics: {},
    };

    const row = mapLinkedInResponseToMetric({
      listingId: 'listing-uuid-2',
      shareUrn: 'urn:li:share:1',
      postedAt: POSTED_AT,
      capturedAt: FROZEN_CAPTURED_AT,
      statistics: stats,
    });

    expect(row.reach).toBe(0);
    expect(row.impressions).toBe(0);
    expect(row.clicks).toBe(0);
    expect(row.leads).toBe(0);
    expect(row.cpl_cents).toBeNull();
  });

  it('zero-fills when statistics is null (deleted share / 404)', () => {
    const row = mapLinkedInResponseToMetric({
      listingId: 'listing-uuid-3',
      shareUrn: 'urn:li:share:deleted',
      postedAt: POSTED_AT,
      capturedAt: FROZEN_CAPTURED_AT,
      statistics: null,
    });

    expect(row.reach).toBe(0);
    expect(row.impressions).toBe(0);
    expect(row.clicks).toBe(0);
    expect(row.leads).toBe(0);
    expect(row.post_external_id).toBe('urn:li:share:deleted');
  });

  it('floors fractional engagement counters to integers (SQL CHECK requires non-negative integers)', () => {
    const stats: LinkedInShareStatisticElement = {
      share: 'urn:li:share:fractional',
      totalShareStatistics: {
        // LinkedIn's `engagement` field is fractional but we don't
        // store it. Some API responses surface fractional impressions
        // when an experiment bucket runs — defend against it.
        clickCount: 1.9,
        impressionCount: 99.4,
        uniqueImpressionsCount: 50.7,
      },
    };

    const row = mapLinkedInResponseToMetric({
      listingId: 'listing-uuid-4',
      shareUrn: 'urn:li:share:fractional',
      postedAt: POSTED_AT,
      capturedAt: FROZEN_CAPTURED_AT,
      statistics: stats,
    });

    expect(Number.isInteger(row.clicks)).toBe(true);
    expect(Number.isInteger(row.impressions)).toBe(true);
    expect(Number.isInteger(row.reach)).toBe(true);
    expect(row.clicks).toBe(1);
    expect(row.impressions).toBe(99);
    expect(row.reach).toBe(50);
  });

  it('clamps negative counters to 0 (defensive — SQL CHECK enforces >= 0)', () => {
    const stats: LinkedInShareStatisticElement = {
      share: 'urn:li:share:negative',
      totalShareStatistics: {
        clickCount: -5,
        impressionCount: -1,
        uniqueImpressionsCount: -100,
      },
    };

    const row = mapLinkedInResponseToMetric({
      listingId: 'listing-uuid-5',
      shareUrn: 'urn:li:share:negative',
      postedAt: POSTED_AT,
      capturedAt: FROZEN_CAPTURED_AT,
      statistics: stats,
    });

    expect(row.clicks).toBe(0);
    expect(row.impressions).toBe(0);
    expect(row.reach).toBe(0);
  });

  it('always writes platform=linkedin, currency=USD, leads=0, cpl_cents=null for organic shares', () => {
    const row = mapLinkedInResponseToMetric({
      listingId: 'listing-uuid-6',
      shareUrn: 'urn:li:share:invariants',
      postedAt: POSTED_AT,
      capturedAt: FROZEN_CAPTURED_AT,
      statistics: {
        share: 'urn:li:share:invariants',
        totalShareStatistics: { impressionCount: 100, uniqueImpressionsCount: 50 },
      },
    });

    expect(row.platform).toBe('linkedin');
    expect(row.currency).toBe('USD');
    expect(row.leads).toBe(0);
    expect(row.cpl_cents).toBeNull();
  });
});
