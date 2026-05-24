import { describe, it, expect } from 'vitest';
import { resolveEffectivePlanId } from '@/lib/billing/plan-gating';

/**
 * Unit test for the manual-override precedence rule. Pure function;
 * no mocks needed. Covers:
 *   - No manual override → returns Stripe-derived plan
 *   - Active timed override → returns override
 *   - Permanent override (expires_at = null) → returns override
 *   - Expired override → falls back to Stripe-derived plan
 *   - All-null → null
 */

describe('resolveEffectivePlanId', () => {
  it('returns currentPlanId when no manual override is set', () => {
    expect(
      resolveEffectivePlanId({
        currentPlanId: 'aho_pro_automation_monthly',
        manualPlanId: null,
        manualPlanExpiresAt: null,
      }),
    ).toBe('aho_pro_automation_monthly');
  });

  it('returns null when neither is set', () => {
    expect(
      resolveEffectivePlanId({
        currentPlanId: null,
        manualPlanId: null,
        manualPlanExpiresAt: null,
      }),
    ).toBeNull();
  });

  it('returns the manual override when expires_at is in the future', () => {
    const futureIso = new Date(Date.now() + 7 * 86_400_000).toISOString();
    expect(
      resolveEffectivePlanId({
        currentPlanId: null,
        manualPlanId: 'aho_pro_automation_annual',
        manualPlanExpiresAt: futureIso,
      }),
    ).toBe('aho_pro_automation_annual');
  });

  it('returns the manual override over a separately-set currentPlanId when active', () => {
    const futureIso = new Date(Date.now() + 30 * 86_400_000).toISOString();
    expect(
      resolveEffectivePlanId({
        currentPlanId: 'aho_agent_monthly', // user has a paid Agent plan
        manualPlanId: 'aho_pro_automation_monthly', // admin granted Pro
        manualPlanExpiresAt: futureIso,
      }),
    ).toBe('aho_pro_automation_monthly');
  });

  it('treats expires_at = null as a permanent override (Founding 50)', () => {
    expect(
      resolveEffectivePlanId({
        currentPlanId: null,
        manualPlanId: 'aho_pro_automation_annual',
        manualPlanExpiresAt: null,
      }),
    ).toBe('aho_pro_automation_annual');
  });

  it('falls back to currentPlanId when manual override has expired', () => {
    const pastIso = new Date(Date.now() - 86_400_000).toISOString();
    expect(
      resolveEffectivePlanId({
        currentPlanId: 'aho_agent_monthly',
        manualPlanId: 'aho_pro_automation_monthly',
        manualPlanExpiresAt: pastIso,
      }),
    ).toBe('aho_agent_monthly');
  });

  it('returns null when manual override has expired AND there is no currentPlanId', () => {
    const pastIso = new Date(Date.now() - 86_400_000).toISOString();
    expect(
      resolveEffectivePlanId({
        currentPlanId: null,
        manualPlanId: 'aho_pro_automation_monthly',
        manualPlanExpiresAt: pastIso,
      }),
    ).toBeNull();
  });

  it('falls back to currentPlanId when expires_at is unparseable', () => {
    expect(
      resolveEffectivePlanId({
        currentPlanId: 'aho_agent_monthly',
        manualPlanId: 'aho_pro_automation_monthly',
        manualPlanExpiresAt: 'not-a-date',
      }),
    ).toBe('aho_agent_monthly');
  });
});
