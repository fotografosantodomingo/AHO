/**
 * Unit tests for src/lib/whatsapp/pricing.ts.
 *
 * Phase 4 of docs/AI_AGENT_PLAN.md. Pure-function tests — no
 * network, no fixtures. We exercise the full pricing matrix:
 *
 *   7 launch markets × 3 billed categories × {in, out of window}
 *
 * plus the service-category + service-window invariants and the
 * unknown-market defensive default.
 */

import { describe, expect, it } from 'vitest';
import {
  estimateWhatsappCostCents,
  estimateRemainingMessages,
  type WhatsappMarket,
  type WhatsappCategory,
} from '../../src/lib/whatsapp/pricing';

const MARKETS: WhatsappMarket[] = ['us', 'es', 'pl', 'pt', 'de', 'fr', 'it'];
const BILLED_CATEGORIES: Array<Exclude<WhatsappCategory, 'service'>> = [
  'marketing',
  'utility',
  'authentication',
];

describe('estimateWhatsappCostCents', () => {
  describe('service-window invariant', () => {
    it.each(MARKETS)(
      'is 0 inside the service window for every market (%s)',
      (market) => {
        for (const category of BILLED_CATEGORIES) {
          expect(
            estimateWhatsappCostCents({
              market,
              category,
              isInServiceWindow: true,
            }),
          ).toBe(0);
        }
      },
    );

    it.each(MARKETS)(
      'is 0 for service-category outside the service window (%s)',
      (market) => {
        expect(
          estimateWhatsappCostCents({
            market,
            category: 'service',
            isInServiceWindow: false,
          }),
        ).toBe(0);
      },
    );
  });

  describe('non-service-window billed messages', () => {
    it('returns a non-negative integer for every market × billed-category pair', () => {
      for (const market of MARKETS) {
        for (const category of BILLED_CATEGORIES) {
          const cents = estimateWhatsappCostCents({
            market,
            category,
            isInServiceWindow: false,
          });
          expect(Number.isInteger(cents)).toBe(true);
          expect(cents).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('marketing >= utility >= authentication in every market', () => {
      for (const market of MARKETS) {
        const mk = estimateWhatsappCostCents({
          market,
          category: 'marketing',
          isInServiceWindow: false,
        });
        const ut = estimateWhatsappCostCents({
          market,
          category: 'utility',
          isInServiceWindow: false,
        });
        const auth = estimateWhatsappCostCents({
          market,
          category: 'authentication',
          isInServiceWindow: false,
        });
        // Per Meta's published rates, marketing is always the
        // most expensive category in every market. Utility and
        // authentication can tie (often they do in our table) —
        // we assert >= rather than >.
        expect(mk).toBeGreaterThanOrEqual(ut);
        expect(ut).toBeGreaterThanOrEqual(auth);
      }
    });

    it('DE marketing is the most expensive launch-market marketing rate', () => {
      // Calibration check — pins the table shape so a future
      // re-pricing flips this assertion before silently changing
      // budget math. DE is documented as tier-1 EU in the Meta
      // 2026 sheet.
      const deRate = estimateWhatsappCostCents({
        market: 'de',
        category: 'marketing',
        isInServiceWindow: false,
      });
      for (const market of MARKETS) {
        if (market === 'de') continue;
        const otherRate = estimateWhatsappCostCents({
          market,
          category: 'marketing',
          isInServiceWindow: false,
        });
        expect(deRate).toBeGreaterThanOrEqual(otherRate);
      }
    });

    it('US marketing is the cheapest launch-market marketing rate', () => {
      // Other half of the calibration — US is documented as
      // tier-2 in Meta's sheet.
      const usRate = estimateWhatsappCostCents({
        market: 'us',
        category: 'marketing',
        isInServiceWindow: false,
      });
      for (const market of MARKETS) {
        if (market === 'us') continue;
        const otherRate = estimateWhatsappCostCents({
          market,
          category: 'marketing',
          isInServiceWindow: false,
        });
        expect(usRate).toBeLessThanOrEqual(otherRate);
      }
    });
  });

  describe('unknown-market defensive default', () => {
    it('returns the highest in-table rate for an unmapped market', () => {
      const unknown = estimateWhatsappCostCents({
        // Cast bypass — the runtime fallback path is what we're
        // testing, not the type system.
        market: 'xx' as WhatsappMarket,
        category: 'marketing',
        isInServiceWindow: false,
      });
      // The unknown rate must be at least as high as DE's
      // marketing rate (the highest in-table value).
      const deRate = estimateWhatsappCostCents({
        market: 'de',
        category: 'marketing',
        isInServiceWindow: false,
      });
      expect(unknown).toBeGreaterThanOrEqual(deRate);
    });

    it('still returns 0 for an unmapped market inside the service window', () => {
      expect(
        estimateWhatsappCostCents({
          market: 'xx' as WhatsappMarket,
          category: 'marketing',
          isInServiceWindow: true,
        }),
      ).toBe(0);
    });
  });
});

describe('estimateRemainingMessages', () => {
  it('returns Infinity when per-message cost is 0', () => {
    expect(
      estimateRemainingMessages({
        remainingBudgetCents: 1000,
        perMessageCents: 0,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('floor-divides remaining budget by per-message cost', () => {
    expect(
      estimateRemainingMessages({
        remainingBudgetCents: 1000,
        perMessageCents: 13, // DE marketing
      }),
    ).toBe(76); // floor(1000/13) = 76
  });

  it('clamps to 0 when over budget', () => {
    expect(
      estimateRemainingMessages({
        remainingBudgetCents: -50,
        perMessageCents: 13,
      }),
    ).toBe(0);
  });

  it('handles the zero-budget zero-cost edge', () => {
    expect(
      estimateRemainingMessages({
        remainingBudgetCents: 0,
        perMessageCents: 0,
      }),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});
