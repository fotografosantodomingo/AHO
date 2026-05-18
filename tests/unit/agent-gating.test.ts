/**
 * Unit tests for src/lib/ai/gating.ts — the AHO AI customer-service
 * agent's confidence + risk + HITL gate. Pure function = no mocks.
 *
 * Spec: docs/AI_AGENT_PLAN.md §5.3 (gating table is the contract).
 *
 * Per PO decision D2=A, every channel is HITL in v1 — the
 * autoSendPolicyEnabled flag is false in production today. These
 * tests pin the behavior in BOTH modes so the flip to D2=B (4-6
 * weeks out) doesn't require a re-spec.
 *
 * Per D5=A, AI is bundled into Pro Automation but pro_automation is
 * HITL-only in v1 even when the auto-send policy is on. Super Pro is
 * the auto-send tier.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyAssistantTurn,
  type GatingInput,
} from '@/lib/ai/gating';

// Compact factory — lets each test override just the fields it cares
// about. Defaults model the D2=A production posture (autoSend off,
// Super Pro tier so any HITL is purely the autoSend flag's doing).
function input(overrides: Partial<GatingInput> = {}): GatingInput {
  return {
    userMessage: 'Can I see this property next weekend?',
    assistantDraft:
      "Sure! Maria has Saturday at 11am or 3pm open. Which works better for you?",
    tier: 'super_pro',
    autoSendPolicyEnabled: false,
    ...overrides,
  };
}

describe('classifyAssistantTurn — intent detection', () => {
  it('empty user message → intent=other', () => {
    const r = classifyAssistantTurn(input({ userMessage: '' }));
    expect(r.intent).toBe('other');
  });

  it('whitespace-only user message → intent=other', () => {
    const r = classifyAssistantTurn(input({ userMessage: '   \n\t  ' }));
    expect(r.intent).toBe('other');
  });

  it('viewing-request phrasing → intent=viewing-request', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: "I'd like to schedule a tour for Saturday" }),
    );
    expect(r.intent).toBe('viewing-request');
  });

  it('price-question phrasing → intent=price-question', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: "What's the asking price for this listing?",
        assistantDraft: 'The asking price is $425,000 as listed.',
      }),
    );
    expect(r.intent).toBe('price-question');
  });

  it('availability phrasing → intent=availability', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'Is it still available?' }),
    );
    expect(r.intent).toBe('availability');
  });

  it('amenity-question phrasing → intent=amenity-question', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'Does it have a pool?' }),
    );
    expect(r.intent).toBe('amenity-question');
  });

  it('location-question phrasing → intent=location-question', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'What neighborhood is it in?' }),
    );
    expect(r.intent).toBe('location-question');
  });

  it('fallback → general-inquiry when no pattern matches', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'Tell me more about Maria.' }),
    );
    expect(r.intent).toBe('general-inquiry');
  });
});

describe('classifyAssistantTurn — viewing-request (the canonical safe case)', () => {
  const viewing = input({
    userMessage: "I'd like to schedule a tour for this Saturday afternoon",
    assistantDraft:
      'Maria has 1pm and 3pm open Saturday. Which time works for you?',
  });

  it('detects viewing intent with high confidence and no risk flags', () => {
    const r = classifyAssistantTurn(viewing);
    expect(r.intent).toBe('viewing-request');
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
    expect(r.riskFlags).toEqual([]);
  });

  it('autoSendPolicyEnabled=false (D2=A default) → pending even on safe intent', () => {
    const r = classifyAssistantTurn({
      ...viewing,
      autoSendPolicyEnabled: false,
    });
    expect(r.approvalStatus).toBe('pending');
    expect(r.reason).toMatch(/autoSend policy disabled/i);
  });

  it('autoSendPolicyEnabled=true + tier=super_pro → auto_send', () => {
    const r = classifyAssistantTurn({
      ...viewing,
      autoSendPolicyEnabled: true,
      tier: 'super_pro',
    });
    expect(r.approvalStatus).toBe('auto_send');
    expect(r.reason).toMatch(/auto_send/);
  });

  it('autoSendPolicyEnabled=true + tier=agency → auto_send', () => {
    const r = classifyAssistantTurn({
      ...viewing,
      autoSendPolicyEnabled: true,
      tier: 'agency',
    });
    expect(r.approvalStatus).toBe('auto_send');
  });
});

describe('classifyAssistantTurn — tier policy (D5=A)', () => {
  const safeAutoSendOn = {
    userMessage: 'Does it have a parking garage?',
    assistantDraft: 'Yes, the listing includes one assigned parking space.',
    autoSendPolicyEnabled: true,
  };

  it('pro_automation + high-confidence safe intent + autoSend on → still pending (HITL in v1)', () => {
    const r = classifyAssistantTurn(
      input({ ...safeAutoSendOn, tier: 'pro_automation' }),
    );
    expect(r.approvalStatus).toBe('pending');
    expect(r.reason).toMatch(/tier pro_automation is HITL-only/i);
  });

  it('free + high-confidence safe intent + autoSend on → pending', () => {
    const r = classifyAssistantTurn(
      input({ ...safeAutoSendOn, tier: 'free' }),
    );
    expect(r.approvalStatus).toBe('pending');
    expect(r.reason).toMatch(/tier free is HITL-only/i);
  });

  it('super_pro + same input → auto_send', () => {
    const r = classifyAssistantTurn(
      input({ ...safeAutoSendOn, tier: 'super_pro' }),
    );
    expect(r.approvalStatus).toBe('auto_send');
  });
});

describe('classifyAssistantTurn — risk flag forces HITL regardless of tier', () => {
  it('price_negotiation flag (assistant offers to lower price) → pending even for super_pro', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Is there any flexibility on the price?',
        assistantDraft:
          'I can lower the price to $400,000 if you can close in 30 days.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('price_negotiation');
    expect(r.approvalStatus).toBe('pending');
    expect(r.reason).toMatch(/risk flag/i);
  });

  it('financial flag (assistant quotes a specific monthly payment) → pending', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'How does the mortgage work?',
        assistantDraft:
          'Your monthly payment would be about $2,100 with a 30-year fixed at the current rate.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('financial');
    expect(r.approvalStatus).toBe('pending');
  });

  it('legal flag (assistant gives contract advice) → pending', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Should I sign the disclosure?',
        assistantDraft:
          "Yes, you should sign — the contract requires it before the inspection.",
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('legal');
    expect(r.approvalStatus).toBe('pending');
  });

  it('commission flag (commission discussed) → pending', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'What is the buyer agent commission on this listing?',
        assistantDraft:
          'The buyer agent commission is 2.5% per the listing terms.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('commission');
    expect(r.approvalStatus).toBe('pending');
  });
});

describe('classifyAssistantTurn — discrimination detection', () => {
  it('buyer asks for "only families" → discrimination flag (origin = user side)', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage:
          'I want only families in the building please, no single people.',
        assistantDraft:
          "Let me connect you with Maria to discuss your housing preferences.",
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('discrimination');
    expect(r.approvalStatus).toBe('pending');
  });

  it('buyer asks "no kids in building" → discrimination flag', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Are there no children in the building?',
        assistantDraft: 'I can pass that question along to Maria.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    // Note: matches both /no\s+(kids|children...)/ and similar.
    expect(r.riskFlags).toContain('discrimination');
  });

  it('assistant draft itself contains discriminatory language → flagged', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Tell me about the neighborhood.',
        assistantDraft:
          'The building is great for Christian families only — very traditional.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('discrimination');
    expect(r.approvalStatus).toBe('pending');
  });
});

describe('classifyAssistantTurn — escalate intent', () => {
  it('"let me speak to a human" → escalate (overrides any other signal)', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Stop, let me speak to a human please.',
        assistantDraft: "I'll connect you with Maria right now.",
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.intent).toBe('escalate');
    expect(r.approvalStatus).toBe('escalate');
  });

  it('"I want to talk to a real person" → escalate', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'I want to talk to a real person' }),
    );
    expect(r.intent).toBe('escalate');
    expect(r.approvalStatus).toBe('escalate');
  });

  it('"no AI" → escalate', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'No AI please' }),
    );
    expect(r.intent).toBe('escalate');
    expect(r.approvalStatus).toBe('escalate');
  });

  it('escalate beats discrimination — even if buyer message also matches', () => {
    // Edge case: buyer escalates AND uses problematic phrasing. The
    // escalate intent decides the approval path; the human takeover
    // surface handles the rest.
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Let me talk to a human, only families please',
        assistantDraft: "I'll connect you to Maria.",
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.intent).toBe('escalate');
    expect(r.approvalStatus).toBe('escalate');
  });
});

describe('classifyAssistantTurn — multiple risk flags accumulate', () => {
  it('legal + financial in same draft → both flags present', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage:
          'What do I need to do for the mortgage and the inspection contingency?',
        assistantDraft:
          "You should sign the inspection contingency clause; your monthly payment will be $1,850 with a 30-year fixed at the current rate.",
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('legal');
    expect(r.riskFlags).toContain('financial');
    expect(r.approvalStatus).toBe('pending');
  });

  it('discrimination + commission in same draft → both flags', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Tell me about fees and the neighborhood.',
        assistantDraft:
          'The commission is 3%. The building is Christian families only.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.riskFlags).toContain('discrimination');
    expect(r.riskFlags).toContain('commission');
  });
});

describe('classifyAssistantTurn — reason field', () => {
  it('reason is non-empty for every decision path', () => {
    const samples: GatingInput[] = [
      input(), // pending (autoSend off)
      input({
        autoSendPolicyEnabled: true,
        tier: 'super_pro',
      }), // auto_send
      input({
        autoSendPolicyEnabled: true,
        tier: 'pro_automation',
      }), // pending (tier)
      input({
        assistantDraft: 'I can lower the price to $300,000.',
        autoSendPolicyEnabled: true,
      }), // pending (risk)
      input({ userMessage: 'let me speak to a human' }), // escalate
    ];
    for (const s of samples) {
      const r = classifyAssistantTurn(s);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('reason includes the intent', () => {
    const r = classifyAssistantTurn(input());
    expect(r.reason).toContain('intent=viewing-request');
  });

  it('reason includes the tier when tier was the deciding factor', () => {
    const r = classifyAssistantTurn(
      input({
        autoSendPolicyEnabled: true,
        tier: 'pro_automation',
      }),
    );
    expect(r.reason).toMatch(/pro_automation/);
  });

  it('reason includes the risk-flag list when risk was the deciding factor', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: 'Can the price come down?',
        assistantDraft: 'I can lower the price to $400,000.',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.reason).toMatch(/price_negotiation/);
  });
});

describe('classifyAssistantTurn — confidence buckets are deterministic', () => {
  it('same input → same confidence (and same everything else)', () => {
    const i = input();
    const a = classifyAssistantTurn(i);
    const b = classifyAssistantTurn(i);
    expect(a.confidence).toBe(b.confidence);
    expect(a.intent).toBe(b.intent);
    expect(a.riskFlags).toEqual(b.riskFlags);
    expect(a.approvalStatus).toBe(b.approvalStatus);
    expect(a.reason).toBe(b.reason);
  });

  it('safe high-confidence intents (viewing/availability/amenity/location) → 0.95', () => {
    const cases: Array<{ msg: string; draft: string }> = [
      {
        msg: 'Can I see the property Saturday?',
        draft: 'Maria has 11am open.',
      },
      {
        msg: 'Is it still available?',
        draft: 'Yes, the listing is active.',
      },
      {
        msg: 'Does it have parking?',
        draft: 'Yes, one assigned parking space.',
      },
      {
        msg: 'What neighborhood is it in?',
        draft: 'Zona Colonial in Santo Domingo.',
      },
    ];
    for (const c of cases) {
      const r = classifyAssistantTurn(
        input({ userMessage: c.msg, assistantDraft: c.draft }),
      );
      expect(r.confidence).toBe(0.95);
    }
  });

  it('price-question with safe draft → 0.85', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: "What's the asking price?",
        assistantDraft: 'The asking price is $425,000.',
      }),
    );
    expect(r.confidence).toBe(0.85);
  });

  it('general-inquiry with no risk → 0.70', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: "Tell me about Maria's background.",
        assistantDraft: 'Maria has been an agent for 8 years in Santo Domingo.',
      }),
    );
    expect(r.confidence).toBe(0.7);
  });

  it('any risk flag → 0.50', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: "What's the asking price?",
        assistantDraft: 'I can lower the price to $400,000.',
      }),
    );
    expect(r.confidence).toBe(0.5);
  });

  it('escalate intent → 0.20', () => {
    const r = classifyAssistantTurn(
      input({ userMessage: 'let me speak to a human' }),
    );
    expect(r.confidence).toBe(0.2);
  });
});

describe('classifyAssistantTurn — confidence threshold boundary', () => {
  it('confidence === 0.85 (price-question, safe, super_pro, autoSend on) → auto_send', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: "What's the asking price?",
        assistantDraft: 'The asking price is $425,000.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.confidence).toBe(0.85);
    expect(r.approvalStatus).toBe('auto_send');
  });

  it('confidence below 0.85 (general-inquiry → 0.70) → pending even with safe tier + autoSend on', () => {
    const r = classifyAssistantTurn(
      input({
        userMessage: "Tell me about Maria's background.",
        assistantDraft: 'Maria has been an agent for 8 years.',
        tier: 'super_pro',
        autoSendPolicyEnabled: true,
      }),
    );
    expect(r.confidence).toBe(0.7);
    expect(r.confidence).toBeLessThan(0.85);
    expect(r.approvalStatus).toBe('pending');
    expect(r.reason).toMatch(/below 0\.85 threshold/i);
  });
});
