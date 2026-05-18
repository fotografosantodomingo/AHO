/**
 * WhatsApp Business Platform per-message cost estimator.
 *
 * Phase 4 of docs/AI_AGENT_PLAN.md. Pure function — no env, no DB,
 * no network. Mirrors the style of src/lib/listings/photo-seo.ts.
 *
 * Meta's pricing model (as of 2026, post-Jan-2026 restructure):
 *
 *   - SERVICE WINDOW (24h since the buyer's last inbound): FREE for
 *     every conversation, regardless of message type. AHO absorbs
 *     the WhatsApp infra cost (€49/mo per number to 360dialog);
 *     in-service-window outbound is the wedge.
 *
 *   - OUT-OF-WINDOW templates: priced PER MESSAGE by Meta, varying
 *     by destination market + category. Categories:
 *
 *       marketing       — promotional ("3 new listings match")
 *       utility         — transactional ("your viewing is confirmed")
 *       authentication  — OTP codes
 *       service         — Phase-4-deprecated label (Meta merged into
 *                          the service-window free tier early 2024;
 *                          we treat it as service-window-only here)
 *
 * The numbers below are the published per-market rates for the 7
 * launch markets in `docs/AI_AGENT_PLAN.md` (US / ES / PL / PT / DE /
 * FR / IT), expressed in USD cents per message. Source: Meta
 * developers.facebook.com/docs/whatsapp/pricing (Jan 2026 sheet) +
 * 360dialog's mirror at 360dialog.com/pricing.
 *
 * Rates are stored as integer USD cents (no fractional cents) to
 * match the schema (whatsapp_messages.cost_cents bigint-safe int).
 * Meta quotes some markets in fractions of a cent — we round UP to
 * the nearest cent so our budget enforcement is never too lax.
 */

export type WhatsappMarket = 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

export type WhatsappCategory =
  | 'marketing'
  | 'utility'
  | 'authentication'
  | 'service';

export interface EstimateWhatsappCostArgs {
  /** Destination buyer market — matches the 7 AHO launch markets. */
  market: WhatsappMarket;
  /** Template category. Service-window-free messages pass 'service'. */
  category: WhatsappCategory;
  /** True if Meta's 24-hour customer-care window is open. Always
   *  zero-cost when true, regardless of category. */
  isInServiceWindow: boolean;
}

/**
 * Per-market per-category rates in USD cents per message.
 *
 * Rounded UP to the nearest cent from Meta's published rates so
 * monthly-spend caps don't accidentally drift over budget by
 * sub-cent fractions multiplied across hundreds of messages.
 *
 * Authentication-category rates track utility-category rates for
 * v1 (we don't ship OTP via WhatsApp yet; the AHO auth surface uses
 * email + TOTP). They're populated so the function returns sane
 * answers if a caller hits that path; revise when authentication
 * messaging actually ships.
 */
const RATE_TABLE: Record<
  WhatsappMarket,
  Record<Exclude<WhatsappCategory, 'service'>, number>
> = {
  // United States. Lowest marketing rate among launch markets;
  // Meta classifies the US as a price-sensitive tier-2 market in
  // their 2026 sheet.
  us: { marketing: 3, utility: 1, authentication: 1 },
  // Spain. Mid-tier in Meta's EU pricing.
  es: { marketing: 7, utility: 3, authentication: 3 },
  // Poland. Below DE/FR/IT but above ES.
  pl: { marketing: 5, utility: 2, authentication: 2 },
  // Portugal. Closest to ES; same tier in Meta's sheet.
  pt: { marketing: 7, utility: 3, authentication: 3 },
  // Germany. Highest marketing rate of the 7; Meta's tier-1 EU.
  de: { marketing: 13, utility: 4, authentication: 4 },
  // France. Tier-1 EU, slightly below DE.
  fr: { marketing: 10, utility: 4, authentication: 4 },
  // Italy. Between PT and FR.
  it: { marketing: 6, utility: 3, authentication: 3 },
};

/**
 * Returns the per-message cost in USD cents.
 *
 * Service-window messages are always 0. Service-category messages
 * are always 0 (the category exists in the Meta schema for v1
 * backcompat but is effectively merged into the service-window
 * free tier).
 *
 * Unknown markets default to the most expensive observed rate so an
 * un-mapped market over-charges rather than under-charges (defense-
 * in-depth on the budget cap).
 */
export function estimateWhatsappCostCents(
  args: EstimateWhatsappCostArgs,
): number {
  if (args.isInServiceWindow) return 0;
  if (args.category === 'service') return 0;

  const marketRates = RATE_TABLE[args.market];
  if (!marketRates) {
    // Defensive default — pick the highest rate in the table for
    // the requested category. Ensures a budget-cap caller errs on
    // the conservative side rather than under-billing.
    return defaultRateForCategory(args.category);
  }

  return marketRates[args.category];
}

function defaultRateForCategory(
  category: Exclude<WhatsappCategory, 'service'>,
): number {
  let max = 0;
  for (const m of Object.values(RATE_TABLE)) {
    const v = m[category];
    if (v > max) max = v;
  }
  return max;
}

/**
 * Convenience helper for the budget-cap UI. Given a monthly budget
 * in cents and a per-message cost, return how many messages the
 * remaining budget covers. Returns Infinity for zero-cost categories.
 */
export function estimateRemainingMessages(args: {
  remainingBudgetCents: number;
  perMessageCents: number;
}): number {
  if (args.perMessageCents <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor(args.remainingBudgetCents / args.perMessageCents));
}
