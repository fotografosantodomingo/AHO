/**
 * Audit-log payload builders.
 *
 * RULE (locked 2026-05-01 after the closing_notes/prior_status leak audit):
 * any field placed into `audit_log.payload` for a kind that is in the
 * 0014 anon-read IN-list is publicly readable. Therefore the payloads
 * we build here are restricted to public-safe lifecycle facts only —
 * the same facts that would appear on a public price-history block.
 *
 * Specifically excluded from every payload:
 *   - closing_notes  (private agent notes; lives on properties row,
 *                     not in audit history)
 *   - prior_status   (lifecycle state transitions are private; reveals
 *                     draft/pending/coming_soon trajectory)
 *
 * Excluded even from kinds that are NOT in the 0014 IN-list today
 * (e.g. listing.archived) — defensively, in case a future PR widens
 * the IN-list. If a future feature genuinely needs private fields in
 * audit context, build a separate "agent-only audit view" that reads
 * from a different table, do NOT re-add private fields here.
 */

export interface SoldAuditInput {
  status: 'sold' | 'rented';
  soldDate: string;
  soldPriceCents?: number | null;
  representedSide?: 'buyer' | 'seller' | 'both' | null;
}

export type SoldAuditPayload = {
  sold_date: string;
  sold_price_cents: number | null;
  represented_side: 'buyer' | 'seller' | 'both' | null;
};

export function buildSoldAuditPayload(input: SoldAuditInput): SoldAuditPayload {
  return {
    sold_date: input.soldDate,
    sold_price_cents: input.soldPriceCents ?? null,
    represented_side: input.representedSide ?? null,
  };
}

export interface ArchiveAuditInput {
  newStatus: 'archived' | 'draft';
}

export type ArchiveAuditPayload = {
  new_status: 'archived' | 'draft';
};

export function buildArchiveAuditPayload(input: ArchiveAuditInput): ArchiveAuditPayload {
  return {
    new_status: input.newStatus,
  };
}
