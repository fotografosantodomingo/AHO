/**
 * Single source of truth for the $5 private-owner listing product.
 *
 * **Why this file exists** — on 2026-05-19 (commit ab3997f), the
 * user-facing copy was bumped from 60 → 90 days across messages/*.json
 * + the sell page + the JSON-LD. The change DID NOT cascade to:
 *   (a) the billing handler that sets `properties.expires_at`
 *       — `lib/billing/handlers/private-listing-purchase.ts:143` was
 *       hardcoded as `SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000`
 *   (b) the AHO Assistant knowledge base — `lib/ai/aho-platform-kb.ts`
 *       was still telling customers "60-day publication window"
 *   (c) the Stripe product setup script
 *
 * Result: customers paid $5 expecting 90 days (per marketing) but
 * the system gave them 60. Caught 2026-05-24 from an iPhone
 * screenshot of the AHO Assistant. Consumer-protection grade bug;
 * CLAUDE.md hard rule #8 (no fake / inconsistent data) territory.
 *
 * **Rule for future edits:** every place that asserts the duration
 * OR price of the $5 listing IMPORTS from here. The marketing copy
 * is allowed to use a hard-coded number IF it's static-rendered
 * from this constant at build time (current messages/*.json values
 * are fine — they're authored alongside this file's value and a
 * test enforces consistency). The billing math, the AI KB, the
 * Stripe script, and any in-page formatter MUST import + use.
 *
 * Adding a regression test that asserts the KB body string contains
 * the constant value is the belt-and-suspenders against drift —
 * see tests/unit/private-listing-constants.test.ts.
 */

/** Days a $5 private-owner listing stays live before it expires. */
export const PRIVATE_LISTING_DURATION_DAYS = 90;

/** Same value in milliseconds — convenience for Date arithmetic. */
export const PRIVATE_LISTING_DURATION_MS =
  PRIVATE_LISTING_DURATION_DAYS * 24 * 60 * 60 * 1000;

/** USD price of one private-owner listing (charged once, no auto-renew). */
export const PRIVATE_LISTING_PRICE_USD = 5;

/** Stripe minor units (cents) for the same price. */
export const PRIVATE_LISTING_PRICE_CENTS = PRIVATE_LISTING_PRICE_USD * 100;
