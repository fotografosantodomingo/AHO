import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFounderRateOpen, isFounderEligible } from '../../src/lib/billing/founder-rate';

describe('isFounderRateOpen', () => {
  const original = process.env.AHO_FOUNDER_RATE_WINDOW_END;

  afterEach(() => {
    if (original === undefined) delete process.env.AHO_FOUNDER_RATE_WINDOW_END;
    else process.env.AHO_FOUNDER_RATE_WINDOW_END = original;
  });

  it('returns false when the env var is unset', () => {
    delete process.env.AHO_FOUNDER_RATE_WINDOW_END;
    expect(isFounderRateOpen()).toBe(false);
  });

  it('returns false when the env var is unparseable', () => {
    process.env.AHO_FOUNDER_RATE_WINDOW_END = 'not a date';
    expect(isFounderRateOpen()).toBe(false);
  });

  it('returns true when now < end', () => {
    process.env.AHO_FOUNDER_RATE_WINDOW_END = '2030-01-01T00:00:00Z';
    expect(isFounderRateOpen(new Date('2026-04-29T00:00:00Z'))).toBe(true);
  });

  it('returns false when now >= end', () => {
    process.env.AHO_FOUNDER_RATE_WINDOW_END = '2024-01-01T00:00:00Z';
    expect(isFounderRateOpen(new Date('2026-04-29T00:00:00Z'))).toBe(false);
  });

  it('returns false at exactly the end timestamp', () => {
    process.env.AHO_FOUNDER_RATE_WINDOW_END = '2026-04-29T00:00:00Z';
    expect(isFounderRateOpen(new Date('2026-04-29T00:00:00Z'))).toBe(false);
  });
});

describe('isFounderEligible', () => {
  beforeEach(() => {
    process.env.AHO_FOUNDER_RATE_WINDOW_END = '2030-01-01T00:00:00Z';
  });

  it('matches agent + monthly within the window', () => {
    expect(isFounderEligible({ tier: 'agent', billing_period: 'monthly' })).toBe(true);
  });

  it('rejects annual plans', () => {
    expect(isFounderEligible({ tier: 'agent', billing_period: 'annual' })).toBe(false);
  });

  it('rejects non-agent tiers', () => {
    expect(isFounderEligible({ tier: 'agency', billing_period: 'monthly' })).toBe(false);
    expect(isFounderEligible({ tier: 'expert', billing_period: 'monthly' })).toBe(false);
    expect(isFounderEligible({ tier: 'premium', billing_period: 'monthly' })).toBe(false);
  });

  it('rejects when the window is closed', () => {
    process.env.AHO_FOUNDER_RATE_WINDOW_END = '2024-01-01T00:00:00Z';
    expect(isFounderEligible({ tier: 'agent', billing_period: 'monthly' })).toBe(false);
  });
});
