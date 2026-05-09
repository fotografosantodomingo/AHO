import { describe, expect, it } from 'vitest';
import {
  evaluateLockout,
  LOCKOUT_TIERS,
  type LockoutCounts,
} from '../../src/lib/auth/lockout';

const NOW = new Date('2026-05-08T12:00:00Z');

function counts(c: Partial<LockoutCounts>): LockoutCounts {
  return { count10m: 0, count30m: 0, count60m: 0, ...c };
}

describe('evaluateLockout — pure threshold logic', () => {
  it('passes when there are zero failures', () => {
    const decision = evaluateLockout(counts({}), null, NOW);
    expect(decision.blocked).toBe(false);
    expect(decision.reason).toBeUndefined();
  });

  it('passes when failures are below the lowest tier (4 in 10m)', () => {
    const decision = evaluateLockout(
      counts({ count10m: 4, count30m: 4, count60m: 4 }),
      new Date(NOW.getTime() - 30_000),
      NOW,
    );
    expect(decision.blocked).toBe(false);
  });

  it('triggers cooldown_1m at exactly 5 failures in 10m', () => {
    const lastFail = new Date(NOW.getTime() - 5_000);
    const decision = evaluateLockout(
      counts({ count10m: 5, count30m: 5, count60m: 5 }),
      lastFail,
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('cooldown_1m');
    // cooldown_1m = 60 seconds from last failure
    expect(decision.retryAfter?.getTime()).toBe(lastFail.getTime() + 60_000);
  });

  it('triggers cooldown_15m at 10 failures in 30m even when 10m count is also high', () => {
    const lastFail = new Date(NOW.getTime() - 10_000);
    const decision = evaluateLockout(
      counts({ count10m: 8, count30m: 10, count60m: 10 }),
      lastFail,
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('cooldown_15m');
    expect(decision.retryAfter?.getTime()).toBe(lastFail.getTime() + 15 * 60_000);
  });

  it('triggers lockout_24h at 20 failures in 60m (most-severe tier wins)', () => {
    const lastFail = new Date(NOW.getTime() - 1_000);
    const decision = evaluateLockout(
      counts({ count10m: 20, count30m: 20, count60m: 20 }),
      lastFail,
      NOW,
    );
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe('lockout_24h');
    expect(decision.retryAfter?.getTime()).toBe(
      lastFail.getTime() + 24 * 60 * 60 * 1000,
    );
  });

  it('uses now as the cooldown anchor when lastFailureAt is null', () => {
    // Edge case — if the counter says 5 but no row found, fall back to
    // anchoring the cooldown at "now" so we don't crash.
    const decision = evaluateLockout(counts({ count10m: 5 }), null, NOW);
    expect(decision.blocked).toBe(true);
    expect(decision.retryAfter?.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it('echoes the input counts back on the decision', () => {
    const c = counts({ count10m: 3, count30m: 7, count60m: 12 });
    const decision = evaluateLockout(c, null, NOW);
    expect(decision.counts).toEqual(c);
  });

  it('LOCKOUT_TIERS is ordered from most-severe to least-severe', () => {
    // The evaluator depends on this ordering — assert it explicitly so
    // a re-order in the source can't silently downgrade a 24h lockout
    // to a 1m cooldown.
    expect(LOCKOUT_TIERS[0]?.reason).toBe('lockout_24h');
    expect(LOCKOUT_TIERS[1]?.reason).toBe('cooldown_15m');
    expect(LOCKOUT_TIERS[2]?.reason).toBe('cooldown_1m');
  });

  it('thresholds match the canonical tier table (5/10/20)', () => {
    const byReason = Object.fromEntries(
      LOCKOUT_TIERS.map((t) => [t.reason, t]),
    );
    expect(byReason['cooldown_1m']?.threshold).toBe(5);
    expect(byReason['cooldown_1m']?.windowMinutes).toBe(10);
    expect(byReason['cooldown_15m']?.threshold).toBe(10);
    expect(byReason['cooldown_15m']?.windowMinutes).toBe(30);
    expect(byReason['lockout_24h']?.threshold).toBe(20);
    expect(byReason['lockout_24h']?.windowMinutes).toBe(60);
  });
});
