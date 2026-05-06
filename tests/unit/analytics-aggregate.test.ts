import { describe, it, expect } from 'vitest';
import { aggregateOrgEvents } from '@/lib/analytics/queries';

/**
 * Pure aggregator behind /dashboard/analytics. Bug fixed 2026-05-06: the
 * previous `conversionRate = leads / views` used raw event counts, which
 * collapses one-engaged-visitor-with-many-views into a near-zero
 * conversion. The new logic dedupes by visitor identity (user_id OR
 * anonymous_id) — one visitor with 10 views and 1 lead = 100% converted.
 */

const a = (id: string) => ({ user_id: null, anonymous_id: id });
const u = (id: string) => ({ user_id: id, anonymous_id: null });

describe('aggregateOrgEvents', () => {
  it('returns empty buckets on no rows', () => {
    const r = aggregateOrgEvents([]);
    expect(r.total).toBe(0);
    expect(r.uniqueVisitors).toBe(0);
    expect(r.viewingVisitors).toBe(0);
    expect(r.leadingVisitors).toBe(0);
    expect(r.conversionRate).toBeNull();
    expect(r.byType).toEqual({});
  });

  it('counts every event in byType regardless of visitor identity', () => {
    const r = aggregateOrgEvents([
      { event_type: 'property_view', ...a('v1') },
      { event_type: 'property_view', ...a('v1') },
      { event_type: 'property_view', ...a('v1') },
      { event_type: 'lead_form_submit', ...a('v1') },
      { event_type: 'favorite_add', ...u('user-x') },
    ]);
    expect(r.byType.property_view).toBe(3);
    expect(r.byType.lead_form_submit).toBe(1);
    expect(r.byType.favorite_add).toBe(1);
    expect(r.total).toBe(5);
  });

  it('dedups visitor identity across user_id and anonymous_id', () => {
    const r = aggregateOrgEvents([
      { event_type: 'property_view', ...u('user-1') },
      { event_type: 'property_view', ...u('user-1') }, // same user, different event
      { event_type: 'property_view', ...a('anon-A') },
      { event_type: 'property_view', ...a('anon-A') }, // same anon
      { event_type: 'property_view', ...u('user-2') },
    ]);
    expect(r.uniqueVisitors).toBe(3); // user-1, anon-A, user-2
    expect(r.viewingVisitors).toBe(3);
    expect(r.byType.property_view).toBe(5); // raw event count
  });

  it('1 visitor with 10 views + 1 lead → conversion 100% (the fixed bug)', () => {
    const events = Array.from({ length: 10 }, () => ({
      event_type: 'property_view',
      ...u('the-only-visitor'),
    }));
    events.push({ event_type: 'lead_form_submit', ...u('the-only-visitor') });
    const r = aggregateOrgEvents(events);
    expect(r.viewingVisitors).toBe(1);
    expect(r.leadingVisitors).toBe(1);
    expect(r.conversionRate).toBe(1.0);
    // Old buggy calc would have been 1/10 = 0.10
  });

  it('two visitors view, one converts → 50% (per-visitor)', () => {
    const r = aggregateOrgEvents([
      { event_type: 'property_view', ...u('user-A') },
      { event_type: 'property_view', ...u('user-A') },
      { event_type: 'property_view', ...u('user-A') },
      { event_type: 'lead_form_submit', ...u('user-A') },
      { event_type: 'property_view', ...u('user-B') },
      { event_type: 'property_view', ...u('user-B') },
    ]);
    expect(r.viewingVisitors).toBe(2);
    expect(r.leadingVisitors).toBe(1);
    expect(r.conversionRate).toBe(0.5);
  });

  it('counts a leader who never explicitly viewed (lead-only visitor) toward the leadingVisitors set', () => {
    // Edge case: a visitor's view event isn't recorded for whatever
    // reason, but they submit a lead. The leadingVisitors set contains
    // them; viewingVisitors does not. Ratio > 1 is possible.
    const r = aggregateOrgEvents([
      { event_type: 'property_view', ...u('viewer-1') },
      { event_type: 'lead_form_submit', ...u('viewer-1') },
      { event_type: 'lead_form_submit', ...u('lead-only') },
    ]);
    expect(r.viewingVisitors).toBe(1);
    expect(r.leadingVisitors).toBe(2);
    expect(r.conversionRate).toBe(2.0);
  });

  it('null conversion when nobody viewed', () => {
    const r = aggregateOrgEvents([
      { event_type: 'lead_form_submit', ...u('user-A') },
    ]);
    expect(r.conversionRate).toBeNull();
  });

  it('events without any visitor identity are counted in byType but skipped from visitor sets', () => {
    const r = aggregateOrgEvents([
      { event_type: 'property_view', user_id: null, anonymous_id: null },
      { event_type: 'lead_form_submit', user_id: null, anonymous_id: null },
      { event_type: 'property_view', ...u('user-A') },
    ]);
    expect(r.byType.property_view).toBe(2);
    expect(r.byType.lead_form_submit).toBe(1);
    expect(r.uniqueVisitors).toBe(1); // only user-A
    expect(r.conversionRate).toBe(0); // user-A viewed, no leads with identity
  });

  it('does not collide u: and a: prefixes when the underlying ids match', () => {
    // The visitor key prefix prevents accidental collision between a
    // user_id and an anonymous_id that happen to share the same UUID.
    const r = aggregateOrgEvents([
      { event_type: 'property_view', ...u('00000000-0000-0000-0000-000000000001') },
      { event_type: 'property_view', ...a('00000000-0000-0000-0000-000000000001') },
    ]);
    expect(r.uniqueVisitors).toBe(2);
  });
});
