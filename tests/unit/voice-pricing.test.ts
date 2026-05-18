/**
 * Unit tests for `src/lib/voice/pricing.ts`.
 *
 * Pure-function tests — no network, no fixtures. Validates the cost
 * matrix per market for the three benchmark durations called out in
 * AI_AGENT_PLAN §4d:
 *
 *   - 5 min    — short inquiry; typical informational call
 *   - 30 min   — bundled monthly allowance per agent
 *   - 60 min   — soft-cap on agent_phone_numbers.monthly_minute_budget
 *
 * The exact rates are documented in the implementation; the tests
 * pin DOWN the expected total + the breakdown components so any
 * future rate change is a deliberate, reviewed edit.
 */

import { describe, expect, it } from 'vitest';
import {
  estimateVoiceCostCents,
  voiceCostCents,
  type VoiceMarket,
} from '@/lib/voice/pricing';

describe('estimateVoiceCostCents', () => {
  const allMarkets: VoiceMarket[] = ['us', 'es', 'pl', 'pt', 'de', 'fr', 'it'];

  it('returns zero for zero-duration calls in every market', () => {
    for (const market of allMarkets) {
      const out = estimateVoiceCostCents({ durationSeconds: 0, market });
      expect(out.totalCents).toBe(0);
      expect(out.twilioCents).toBe(0);
      expect(out.sttCents).toBe(0);
      expect(out.llmCents).toBe(0);
      expect(out.ttsCents).toBe(0);
    }
  });

  it('clamps negative durations to zero', () => {
    const out = estimateVoiceCostCents({ durationSeconds: -120, market: 'us' });
    expect(out.totalCents).toBe(0);
  });

  it('clamps non-finite durations to zero', () => {
    const nan = estimateVoiceCostCents({ durationSeconds: Number.NaN, market: 'us' });
    const inf = estimateVoiceCostCents({ durationSeconds: Number.POSITIVE_INFINITY, market: 'us' });
    expect(nan.totalCents).toBe(0);
    expect(inf.totalCents).toBe(0);
  });

  it('5-minute call: US baseline', () => {
    // 5 min × (1.4 + 0.58 + 5.0 + 6.0) cents/min = 5 × 12.98 = 64.9
    const out = estimateVoiceCostCents({ durationSeconds: 5 * 60, market: 'us' });
    // Total uses unrounded sum + Math.ceil; components round individually.
    expect(out.totalCents).toBe(65);
    expect(out.twilioCents).toBe(7); // ceil(7.0)
    expect(out.sttCents).toBe(3);    // ceil(2.9)
    expect(out.llmCents).toBe(25);   // ceil(25.0)
    expect(out.ttsCents).toBe(30);   // ceil(30.0)
  });

  it('30-minute call: US baseline matches AI_AGENT_PLAN $5.50 retail math', () => {
    // Per AI_AGENT_PLAN §4d: $5.50/mo total = $1.15 number (NOT
    // included in the per-call computation; that's a fixed-monthly
    // line item) + $0.42 talk + $3.90 inference/STT/TTS = $4.32.
    // Variable per-call cost = 30 × 12.98 cents = 389.4 → ceil 390.
    const out = estimateVoiceCostCents({ durationSeconds: 30 * 60, market: 'us' });
    expect(out.totalCents).toBe(390);
    // Sanity: 390 cents = $3.90, matches the §4d "Inference + STT +
    // TTS: 30 min × $0.13 = $3.90" plus the $0.42 Twilio talk.
    expect(out.totalCents).toBeGreaterThanOrEqual(388);
    expect(out.totalCents).toBeLessThanOrEqual(395);
  });

  it('60-minute call (monthly cap): US baseline doubles the 30-min cost', () => {
    const out30 = estimateVoiceCostCents({ durationSeconds: 30 * 60, market: 'us' });
    const out60 = estimateVoiceCostCents({ durationSeconds: 60 * 60, market: 'us' });
    // Allow ±2 cents of rounding slop between the two computations.
    expect(out60.totalCents).toBeGreaterThanOrEqual(out30.totalCents * 2 - 2);
    expect(out60.totalCents).toBeLessThanOrEqual(out30.totalCents * 2 + 2);
  });

  it('per-market Twilio rates: DE > US (carrier costs in Germany are higher)', () => {
    const us = estimateVoiceCostCents({ durationSeconds: 30 * 60, market: 'us' });
    const de = estimateVoiceCostCents({ durationSeconds: 30 * 60, market: 'de' });
    expect(de.twilioCents).toBeGreaterThan(us.twilioCents);
    // Inference + STT + TTS rates are market-independent.
    expect(de.sttCents).toBe(us.sttCents);
    expect(de.llmCents).toBe(us.llmCents);
    expect(de.ttsCents).toBe(us.ttsCents);
  });

  it('every market produces a positive total for a 30-minute call', () => {
    for (const market of allMarkets) {
      const out = estimateVoiceCostCents({ durationSeconds: 30 * 60, market });
      expect(out.totalCents).toBeGreaterThan(0);
      // None of our markets should produce a >$10 30-min variable cost.
      // That would mean the rate table got corrupted.
      expect(out.totalCents).toBeLessThan(1000);
    }
  });

  it('breakdown components always sum within 5 cents of the total (rounding slop)', () => {
    for (const market of allMarkets) {
      for (const minutes of [5, 30, 60]) {
        const out = estimateVoiceCostCents({ durationSeconds: minutes * 60, market });
        const componentSum = out.twilioCents + out.sttCents + out.llmCents + out.ttsCents;
        // Components round UP individually so their sum is >= total.
        expect(componentSum).toBeGreaterThanOrEqual(out.totalCents);
        expect(componentSum - out.totalCents).toBeLessThanOrEqual(5);
      }
    }
  });

  it('fractional minutes (sub-minute calls) round up correctly', () => {
    // 30 seconds = 0.5 minutes
    const out = estimateVoiceCostCents({ durationSeconds: 30, market: 'us' });
    // 0.5 × 12.98 = 6.49 → ceil → 7 cents
    expect(out.totalCents).toBe(7);
  });

  it('voiceCostCents() convenience wrapper returns the same total', () => {
    for (const market of allMarkets) {
      for (const minutes of [5, 30, 60]) {
        const full = estimateVoiceCostCents({ durationSeconds: minutes * 60, market });
        const conv = voiceCostCents({ durationSeconds: minutes * 60, market });
        expect(conv).toBe(full.totalCents);
      }
    }
  });
});
