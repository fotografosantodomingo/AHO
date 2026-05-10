/**
 * Unit tests for the lead-routing engine.
 *
 * Pure-function exercise of `applyRoutingRules` — no DB, no IO. Tests
 * cover the cases enumerated in the task spec:
 *   - empty rules → falls back to currentAssignment
 *   - single rule matching → returns that rule's assignee
 *   - multiple rules → highest priority wins
 *   - non-matching rule (city mismatch) → tries next rule
 *   - round-robin with N members → cycles correctly
 *
 * Plus the defensive paths the engine guards against:
 *   - inactive rules are skipped
 *   - same-priority ties resolve by created_at ASC
 *   - empty `{}` conditions match every lead
 *   - condition AND-ing (a city-only rule fires regardless of language)
 *   - empty round_robin_user_ids falls back without crashing
 *   - cursor wrapping (out-of-range index does not throw)
 */

import { describe, expect, it } from 'vitest';
import { applyRoutingRules, type RoutingRule } from '../../src/lib/leads/routing';

const FALLBACK = 'fallback-user-id';

const LEAD_MX_ES_APT = {
  city: 'Mexico City',
  countryCode: 'MX',
  language: 'es',
  propertyType: 'apartment',
};

function rule(partial: Partial<RoutingRule> & Pick<RoutingRule, 'action'>): RoutingRule {
  return {
    id: partial.id ?? 'rule-' + Math.random().toString(36).slice(2, 8),
    priority: partial.priority ?? 0,
    createdAt: partial.createdAt ?? '2026-05-01T00:00:00.000Z',
    isActive: partial.isActive ?? true,
    conditions: partial.conditions ?? {},
    action: partial.action,
  };
}

describe('applyRoutingRules — fallback', () => {
  it('returns the fallback when no rules exist', () => {
    const decision = applyRoutingRules([], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe(FALLBACK);
    expect(decision.ruleId).toBeNull();
    expect(decision.newRoundRobinIndex).toBeNull();
  });

  it('returns the fallback when only inactive rules exist', () => {
    const r = rule({
      id: 'r1',
      isActive: false,
      action: { type: 'assign', assign_to_user_id: 'agent-1' },
    });
    const decision = applyRoutingRules([r], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe(FALLBACK);
    expect(decision.ruleId).toBeNull();
  });

  it('returns the fallback when no rule matches', () => {
    const r = rule({
      id: 'r1',
      conditions: { city: 'Cancún' },
      action: { type: 'assign', assign_to_user_id: 'agent-1' },
    });
    const decision = applyRoutingRules([r], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe(FALLBACK);
    expect(decision.ruleId).toBeNull();
  });
});

describe('applyRoutingRules — single rule match', () => {
  it('returns the rule assignee on a single matching rule', () => {
    const r = rule({
      id: 'r1',
      conditions: { city: 'Mexico City' },
      action: { type: 'assign', assign_to_user_id: 'maria' },
    });
    const decision = applyRoutingRules([r], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe('maria');
    expect(decision.ruleId).toBe('r1');
    expect(decision.newRoundRobinIndex).toBeNull();
  });

  it('empty {} conditions match every lead', () => {
    const r = rule({
      id: 'default',
      conditions: {},
      action: { type: 'assign', assign_to_user_id: 'org-default-agent' },
    });
    const decision = applyRoutingRules([r], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe('org-default-agent');
    expect(decision.ruleId).toBe('default');
  });

  it('matches on language alone (city/country irrelevant)', () => {
    const r = rule({
      id: 'es-speaker',
      conditions: { language: 'es' },
      action: { type: 'assign', assign_to_user_id: 'maria' },
    });
    const decision = applyRoutingRules(
      [r],
      { ...LEAD_MX_ES_APT, city: 'Anywhere', countryCode: 'XX' },
      FALLBACK,
    );
    expect(decision.assignTo).toBe('maria');
  });
});

describe('applyRoutingRules — priority ordering', () => {
  it('higher priority rule wins over lower priority', () => {
    const lowPri = rule({
      id: 'low',
      priority: 0,
      conditions: { country_code: 'MX' },
      action: { type: 'assign', assign_to_user_id: 'org-default' },
    });
    const highPri = rule({
      id: 'high',
      priority: 100,
      conditions: { city: 'Mexico City' },
      action: { type: 'assign', assign_to_user_id: 'mexico-city-specialist' },
    });
    // Pass low first to prove the engine sorts internally.
    const decision = applyRoutingRules([lowPri, highPri], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe('mexico-city-specialist');
    expect(decision.ruleId).toBe('high');
  });

  it('non-matching higher-priority rule falls through to lower-priority match', () => {
    const cancunOnly = rule({
      id: 'cancun',
      priority: 100,
      conditions: { city: 'Cancún' },
      action: { type: 'assign', assign_to_user_id: 'cancun-agent' },
    });
    const mexicoFallback = rule({
      id: 'mx',
      priority: 50,
      conditions: { country_code: 'MX' },
      action: { type: 'assign', assign_to_user_id: 'mx-fallback-agent' },
    });
    const decision = applyRoutingRules(
      [cancunOnly, mexicoFallback],
      LEAD_MX_ES_APT,
      FALLBACK,
    );
    expect(decision.assignTo).toBe('mx-fallback-agent');
    expect(decision.ruleId).toBe('mx');
  });

  it('same-priority ties resolve by created_at ASC (oldest first)', () => {
    const newer = rule({
      id: 'newer',
      priority: 10,
      createdAt: '2026-05-09T10:00:00.000Z',
      conditions: { city: 'Mexico City' },
      action: { type: 'assign', assign_to_user_id: 'newer-agent' },
    });
    const older = rule({
      id: 'older',
      priority: 10,
      createdAt: '2026-05-01T10:00:00.000Z',
      conditions: { city: 'Mexico City' },
      action: { type: 'assign', assign_to_user_id: 'older-agent' },
    });
    const decision = applyRoutingRules([newer, older], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe('older-agent');
    expect(decision.ruleId).toBe('older');
  });

  it('AND-ing: a multi-condition rule requires every present condition to match', () => {
    const strict = rule({
      id: 'strict',
      priority: 100,
      conditions: {
        city: 'Mexico City',
        property_type: 'house', // lead is apartment → mismatch
      },
      action: { type: 'assign', assign_to_user_id: 'house-specialist' },
    });
    const lax = rule({
      id: 'lax',
      priority: 50,
      conditions: { city: 'Mexico City' },
      action: { type: 'assign', assign_to_user_id: 'mexico-generalist' },
    });
    const decision = applyRoutingRules([strict, lax], LEAD_MX_ES_APT, FALLBACK);
    expect(decision.assignTo).toBe('mexico-generalist');
    expect(decision.ruleId).toBe('lax');
  });
});

describe('applyRoutingRules — round-robin', () => {
  const rrRule = rule({
    id: 'rr',
    priority: 100,
    conditions: { country_code: 'MX' },
    action: {
      type: 'round_robin',
      round_robin_user_ids: ['agent-a', 'agent-b', 'agent-c'],
    },
  });

  it('returns the user at the cursor index and advances by 1', () => {
    const d0 = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, 0);
    expect(d0.assignTo).toBe('agent-a');
    expect(d0.newRoundRobinIndex).toBe(1);

    const d1 = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, 1);
    expect(d1.assignTo).toBe('agent-b');
    expect(d1.newRoundRobinIndex).toBe(2);

    const d2 = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, 2);
    expect(d2.assignTo).toBe('agent-c');
    // Wrap back to 0.
    expect(d2.newRoundRobinIndex).toBe(0);
  });

  it('cycles cleanly across N+1 invocations', () => {
    const cycle = ['agent-a', 'agent-b', 'agent-c', 'agent-a'];
    let cursor = 0;
    for (const expected of cycle) {
      const d = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, cursor);
      expect(d.assignTo).toBe(expected);
      cursor = d.newRoundRobinIndex!;
    }
  });

  it('falls back when round_robin_user_ids is empty (misconfigured rule)', () => {
    const broken = rule({
      id: 'rr-empty',
      conditions: { country_code: 'MX' },
      action: { type: 'round_robin', round_robin_user_ids: [] },
    });
    const d = applyRoutingRules([broken], LEAD_MX_ES_APT, FALLBACK, 0);
    expect(d.assignTo).toBe(FALLBACK);
    expect(d.ruleId).toBeNull();
    expect(d.newRoundRobinIndex).toBeNull();
  });

  it('wraps an out-of-range cursor (rule list shrunk between calls)', () => {
    // Cursor=5 against a 3-user list. 5 % 3 = 2 → 'agent-c'; advance to 0.
    const d = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, 5);
    expect(d.assignTo).toBe('agent-c');
    expect(d.newRoundRobinIndex).toBe(0);
  });

  it('treats negative / NaN cursors as 0 (defensive)', () => {
    const dNeg = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, -1);
    expect(dNeg.assignTo).toBe('agent-a');
    expect(dNeg.newRoundRobinIndex).toBe(1);

    const dNaN = applyRoutingRules([rrRule], LEAD_MX_ES_APT, FALLBACK, Number.NaN);
    expect(dNaN.assignTo).toBe('agent-a');
    expect(dNaN.newRoundRobinIndex).toBe(1);
  });
});
