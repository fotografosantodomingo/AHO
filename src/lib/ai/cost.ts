import 'server-only';

/**
 * Anthropic per-MTok pricing snapshot — frozen for cost-estimation in
 * `ai_generation_log.estimated_cost_usd_cents`. When Anthropic changes
 * pricing, update these numbers; existing rows stay accurate-to-the-
 * moment because the cost is computed + stored at write time, not at
 * read time.
 *
 * Source: Anthropic public pricing page (matches what the deployed
 * `ANTHROPIC_API_KEY`'s account sees on invoices).
 *
 * Numbers are USD per **million tokens**. Multiply by tokens / 1_000_000
 * to get USD, then × 100 → integer cents (what the DB stores).
 *
 * Add new model entries here as we adopt them; the helper returns 0
 * cost for any unknown model (logged but not fatal — we'd rather miss
 * cost data than block a publish on a pricing-table miss).
 */

interface ModelPrice {
  /** USD per million input tokens */
  inputPerMTok: number;
  /** USD per million output tokens */
  outputPerMTok: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Haiku 4.5 — used by the AI drafter for every draft per locale.
  'claude-haiku-4-5-20251001': { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  // Sonnet 4.6 — used by importFromUrl to scrape source portals.
  'claude-sonnet-4-6': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  'claude-sonnet-4-6-20250508': { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  // Opus 4.7 — not currently used by AHO server code, listed for
  // completeness so admin tools that re-render historical rows don't
  // 0 them out.
  'claude-opus-4-7': { inputPerMTok: 15.0, outputPerMTok: 75.0 },
};

/**
 * Estimate the cost of one Anthropic call in integer USD cents from the
 * model id + input/output token counts. Returns 0 for unknown models
 * (helps surface "we forgot to add the new model id" instead of crashing).
 */
export function estimateCostUsdCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = PRICES[model];
  if (!price) return 0;
  const usd =
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok;
  return Math.round(usd * 100);
}
