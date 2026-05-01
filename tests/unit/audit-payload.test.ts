import { describe, expect, it } from 'vitest';
import {
  buildArchiveAuditPayload,
  buildSoldAuditPayload,
} from '@/lib/audit/audit-payload';

/**
 * Pins the payload-scrub contract documented in
 * `src/lib/audit/audit-payload.ts` (rule locked 2026-05-01 after the
 * closing_notes/prior_status leak audit).
 *
 * Failure of any of these tests means a future writer is about to leak
 * private fields into anon-readable audit_log rows. Investigate and
 * scrub at the builder level — do NOT loosen the assertion.
 */

describe('audit-payload · sold', () => {
  it('omits closing_notes and prior_status from the payload', () => {
    const payload = buildSoldAuditPayload({
      status: 'sold',
      soldDate: '2026-05-01T12:00:00.000Z',
      soldPriceCents: 12_345_600,
      representedSide: 'seller',
    });
    expect(payload).not.toHaveProperty('closing_notes');
    expect(payload).not.toHaveProperty('prior_status');
  });

  it('keeps the public-safe fields intact', () => {
    const payload = buildSoldAuditPayload({
      status: 'sold',
      soldDate: '2026-05-01T12:00:00.000Z',
      soldPriceCents: 12_345_600,
      representedSide: 'seller',
    });
    expect(payload).toEqual({
      sold_date: '2026-05-01T12:00:00.000Z',
      sold_price_cents: 12_345_600,
      represented_side: 'seller',
    });
  });

  it('coerces missing optional fields to null (confidential closing)', () => {
    const payload = buildSoldAuditPayload({
      status: 'rented',
      soldDate: '2026-05-01T12:00:00.000Z',
    });
    expect(payload.sold_price_cents).toBeNull();
    expect(payload.represented_side).toBeNull();
  });

  it('does not introduce extra keys beyond the documented set', () => {
    const payload = buildSoldAuditPayload({
      status: 'sold',
      soldDate: '2026-05-01T12:00:00.000Z',
      soldPriceCents: 100,
      representedSide: 'both',
    });
    const allowed = new Set(['sold_date', 'sold_price_cents', 'represented_side']);
    for (const key of Object.keys(payload)) {
      expect(allowed.has(key)).toBe(true);
    }
  });
});

describe('audit-payload · archive', () => {
  it('omits prior_status (defensive — kind not in 0014 read list today, but rule applies globally)', () => {
    const payload = buildArchiveAuditPayload({ newStatus: 'archived' });
    expect(payload).not.toHaveProperty('prior_status');
    expect(payload).not.toHaveProperty('closing_notes');
  });

  it('keeps new_status', () => {
    expect(buildArchiveAuditPayload({ newStatus: 'archived' })).toEqual({
      new_status: 'archived',
    });
    expect(buildArchiveAuditPayload({ newStatus: 'draft' })).toEqual({
      new_status: 'draft',
    });
  });
});
