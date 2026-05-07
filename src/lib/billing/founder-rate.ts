/**
 * Founder-rate selection logic — when is the founder window open?
 *
 * Window-open semantics: the env var `AHO_FOUNDER_RATE_WINDOW_END` is a
 * single ISO-8601 timestamp. The window is "open" if the env var is set,
 * parses to a valid date, and the current time is strictly before that date.
 * If the env var is unset or unparseable, the window is closed (defensive
 * default — better to silently miss founder rate than silently grant it).
 *
 * Pure function — no side effects. Unit-testable without the rest of the
 * billing stack.
 */
export function isFounderRateOpen(now: Date = new Date()): boolean {
  const endStr = process.env.AHO_FOUNDER_RATE_WINDOW_END;
  if (!endStr) return false;
  const endDate = new Date(endStr);
  if (isNaN(endDate.getTime())) return false;
  return now.getTime() < endDate.getTime();
}

/**
 * Returns true iff this plan is eligible for the founder rate (Agent tier,
 * monthly billing, founder window open). Annual plans are deliberately
 * excluded; the founder rate is a "lifetime $19/mo" promise that doesn't
 * map cleanly to annual billing.
 *
 * The `now` parameter mirrors `isFounderRateOpen` — pass an explicit
 * timestamp from tests to make the result deterministic regardless of
 * how `process.env.AHO_FOUNDER_RATE_WINDOW_END` is currently set, which
 * the singleFork test pool occasionally races on between describe
 * blocks. Production callers continue to use the default (real `now`).
 */
export function isFounderEligible(
  plan: {
    tier: string;
    billing_period: string;
  },
  now: Date = new Date(),
): boolean {
  return (
    plan.tier === 'agent' &&
    plan.billing_period === 'monthly' &&
    isFounderRateOpen(now)
  );
}
