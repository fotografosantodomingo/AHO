import { describe, expect, it } from 'vitest';
import {
  PRIVATE_LISTING_DURATION_DAYS,
  PRIVATE_LISTING_DURATION_MS,
  PRIVATE_LISTING_PRICE_USD,
  PRIVATE_LISTING_PRICE_CENTS,
} from '@/lib/billing/private-listing-constants';
import { ahoPlatformKb } from '@/lib/ai/aho-platform-kb';

/**
 * Drift guard for the $5 private-owner listing product.
 *
 * Origin: 2026-05-19 commit ab3997f bumped the listing-duration copy
 * from 60 → 90 days in messages/*.json + the sell page, but missed:
 *   - the billing handler (lib/billing/handlers/private-listing-purchase.ts)
 *   - the AHO Assistant knowledge base (lib/ai/aho-platform-kb.ts)
 *   - the Stripe setup script
 *
 * Result: customers paid expecting 90 days, system gave 60. Caught
 * 2026-05-24 via screenshot of the AHO Assistant saying "60 days"
 * to a buyer. Consumer-protection grade bug.
 *
 * This test enforces that:
 *   1. The duration constant is in valid range
 *   2. The MS conversion is correct
 *   3. The price stays in single-digit-dollars territory
 *   4. The cents conversion is correct
 *   5. The AHO Platform KB (both locales) cites the same number for
 *      duration that the constant declares — drift caught at test
 *      time instead of by an embarrassed customer.
 */

describe('private-listing constants are coherent + match the KB', () => {
  it('duration constant is in a plausible product range (1-365)', () => {
    expect(PRIVATE_LISTING_DURATION_DAYS).toBeGreaterThan(0);
    expect(PRIVATE_LISTING_DURATION_DAYS).toBeLessThanOrEqual(365);
  });

  it('duration MS == days × 24h', () => {
    expect(PRIVATE_LISTING_DURATION_MS).toBe(
      PRIVATE_LISTING_DURATION_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it('price is in single-digit-dollars territory', () => {
    expect(PRIVATE_LISTING_PRICE_USD).toBeGreaterThan(0);
    expect(PRIVATE_LISTING_PRICE_USD).toBeLessThan(20);
  });

  it('cents == dollars × 100', () => {
    expect(PRIVATE_LISTING_PRICE_CENTS).toBe(PRIVATE_LISTING_PRICE_USD * 100);
  });

  it('English KB cites the same duration number that the constant declares', () => {
    const kb = ahoPlatformKb('en');
    const privateOwner = kb.tiers.find((t) => /private[- ]?owner/i.test(t.name));
    expect(privateOwner).toBeDefined();
    // The description string must literally contain the duration in days.
    expect(privateOwner!.description).toContain(`${PRIVATE_LISTING_DURATION_DAYS}-day`);
    // ... and any keyFeature string mentioning "active listing" must too.
    const featureLine = privateOwner!.keyFeatures.find((f) =>
      /active listing/i.test(f),
    );
    expect(featureLine).toBeDefined();
    expect(featureLine!).toContain(`${PRIVATE_LISTING_DURATION_DAYS} days`);
  });

  it('Spanish KB cites the same duration number that the constant declares', () => {
    const kb = ahoPlatformKb('es');
    const privateOwner = kb.tiers.find((t) => /privado|particular/i.test(t.name));
    expect(privateOwner).toBeDefined();
    expect(privateOwner!.description).toContain(`${PRIVATE_LISTING_DURATION_DAYS} días`);
    const featureLine = privateOwner!.keyFeatures.find((f) =>
      /anuncio activo/i.test(f),
    );
    expect(featureLine).toBeDefined();
    expect(featureLine!).toContain(`${PRIVATE_LISTING_DURATION_DAYS} días`);
  });

  it('English KB does NOT mention the old 60-day duration anywhere in the private-owner tier', () => {
    const kb = ahoPlatformKb('en');
    const privateOwner = kb.tiers.find((t) => /private[- ]?owner/i.test(t.name));
    expect(privateOwner).toBeDefined();
    // Guard against the original drift recurring.
    expect(privateOwner!.description).not.toContain('60-day');
    expect(privateOwner!.description).not.toContain('60 day');
    for (const f of privateOwner!.keyFeatures) {
      expect(f).not.toMatch(/\b60 days\b/);
    }
  });

  it('Spanish KB does NOT mention the old 60-day duration anywhere in the private-owner tier', () => {
    const kb = ahoPlatformKb('es');
    const privateOwner = kb.tiers.find((t) => /privado|particular/i.test(t.name));
    expect(privateOwner).toBeDefined();
    expect(privateOwner!.description).not.toContain('60 días');
    for (const f of privateOwner!.keyFeatures) {
      expect(f).not.toMatch(/\b60 días\b/);
    }
  });
});
