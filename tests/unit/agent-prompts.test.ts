/**
 * Unit tests for `src/lib/ai/agent-prompts.ts`.
 *
 * Pure-function tests — no network, no fixtures. We exercise the
 * (agent, market, buyerLocale, channel, tier) matrix at the boundaries
 * that matter most for liability and trust:
 *   - The opener never claims the AI IS the human agent.
 *   - Market voice picks the right per-market jargon.
 *   - Reply language is driven by buyerLocale, not market.
 *   - Channel constraints land the right shape (no markdown for voice,
 *     1024-char cap for WhatsApp, [[COMPLIANCE_FOOTER]] for email).
 *   - Refusal templates for the five regulated topics are always
 *     present regardless of channel.
 *   - Soft-beta language appears only when listingCount === 0.
 *   - Tier-aware closer differentiates HITL from auto-send.
 *   - Focus listing greets the buyer with the property in mind.
 *   - Prompt length stays inside the 1500-5000 char budget.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAgentSystemPrompt,
  type AgentPromptInput,
} from '@/lib/ai/agent-prompts';

function base(overrides: Partial<AgentPromptInput> = {}): AgentPromptInput {
  return {
    agent: {
      name: 'Maria Lopez',
      languages: ['en', 'es'],
      specialties: ['Beachfront villas', 'Luxury condos'],
      bio: 'Licensed broker since 2015, Santo Domingo native.',
    },
    org: { name: 'Lopez Real Estate' },
    market: 'us',
    buyerLocale: 'en',
    channel: 'web_chat',
    tier: 'pro_automation',
    listingCount: 5,
    ...overrides,
  };
}

describe('buildAgentSystemPrompt', () => {
  it('opener says "AHO AI assistant on behalf of {agent.name}" verbatim', () => {
    const prompt = buildAgentSystemPrompt(base());
    expect(prompt).toContain('AHO AI assistant on behalf of Maria Lopez');
  });

  it('opener never claims to BE the human agent', () => {
    const prompt = buildAgentSystemPrompt(base());
    // Negative: must NOT instruct the model to pretend to be Maria.
    expect(prompt).toMatch(/NEVER claim to BE Maria Lopez/i);
    expect(prompt).toMatch(/NEVER pretend to be human/i);
  });

  it('Polish market uses Polish real-estate jargon', () => {
    const prompt = buildAgentSystemPrompt(base({ market: 'pl', buyerLocale: 'pl' }));
    // Either of these must appear in the per-market vocabulary block.
    expect(prompt).toMatch(/metraż|deweloperski/);
  });

  it('German market uses German real-estate jargon', () => {
    const prompt = buildAgentSystemPrompt(base({ market: 'de', buyerLocale: 'de' }));
    expect(prompt).toMatch(/Wohnfläche|Baujahr/);
  });

  it('Italian market uses Italian real-estate jargon', () => {
    const prompt = buildAgentSystemPrompt(base({ market: 'it', buyerLocale: 'it' }));
    expect(prompt).toMatch(/trilocale|centro storico/);
  });

  it('reply-language instruction matches buyerLocale, not market', () => {
    // Agent's market is Polish, buyer wrote in English → reply must be English.
    const prompt = buildAgentSystemPrompt(
      base({ market: 'pl', buyerLocale: 'en' }),
    );
    expect(prompt).toMatch(/Reply in English/);
    expect(prompt).not.toMatch(/Reply in Polish/);
  });

  it('reply-language honors every supported locale', () => {
    const cases = [
      { locale: 'es', name: 'Spanish' },
      { locale: 'pl', name: 'Polish' },
      { locale: 'pt', name: 'Portuguese' },
      { locale: 'de', name: 'German' },
      { locale: 'fr', name: 'French' },
      { locale: 'it', name: 'Italian' },
    ] as const;
    for (const c of cases) {
      const prompt = buildAgentSystemPrompt(
        base({ market: 'us', buyerLocale: c.locale }),
      );
      expect(prompt).toContain(`Reply in ${c.name}`);
    }
  });

  it('web_chat produces a markdown-unfriendly prompt (no headers)', () => {
    const prompt = buildAgentSystemPrompt(base({ channel: 'web_chat' }));
    expect(prompt).toMatch(/Do NOT use markdown headers/i);
  });

  it('voice channel produces a "no markdown" instruction', () => {
    const prompt = buildAgentSystemPrompt(base({ channel: 'voice' }));
    expect(prompt).toMatch(/NO markdown/i);
    expect(prompt).toMatch(/TTS/);
  });

  it('whatsapp channel produces a "1024 chars" instruction', () => {
    const prompt = buildAgentSystemPrompt(base({ channel: 'whatsapp' }));
    expect(prompt).toMatch(/1024 character/i);
  });

  it('email channel includes the [[COMPLIANCE_FOOTER]] token', () => {
    const prompt = buildAgentSystemPrompt(base({ channel: 'email' }));
    expect(prompt).toContain('[[COMPLIANCE_FOOTER]]');
  });

  it('email channel signs off as "AHO assistant for {agent.name}"', () => {
    const prompt = buildAgentSystemPrompt(base({ channel: 'email' }));
    expect(prompt).toMatch(/AHO assistant for/i);
  });

  it('refusal templates appear regardless of channel', () => {
    const channels = ['web_chat', 'email', 'whatsapp', 'voice'] as const;
    for (const channel of channels) {
      const prompt = buildAgentSystemPrompt(base({ channel }));
      expect(prompt).toMatch(/price negotiation/i);
      expect(prompt).toMatch(/commission/i);
      expect(prompt).toMatch(/financing|mortgage/i);
      expect(prompt).toMatch(/legal/i);
      expect(prompt).toMatch(/discrimination|fair-housing/i);
    }
  });

  it('soft-beta block appears when listingCount === 0', () => {
    const prompt = buildAgentSystemPrompt(base({ listingCount: 0 }));
    expect(prompt).toMatch(/hasn't published any listings/i);
    expect(prompt).toMatch(/take their contact info/i);
  });

  it('soft-beta block does NOT appear when listingCount > 0', () => {
    const prompt = buildAgentSystemPrompt(base({ listingCount: 3 }));
    expect(prompt).not.toMatch(/hasn't published any listings/i);
  });

  it('super_pro tier gets the "authorized to send directly" closer', () => {
    const prompt = buildAgentSystemPrompt(base({ tier: 'super_pro' }));
    expect(prompt).toMatch(/authorized to send directly/i);
  });

  it('agency tier gets the "authorized to send directly" closer', () => {
    const prompt = buildAgentSystemPrompt(base({ tier: 'agency' }));
    expect(prompt).toMatch(/authorized to send directly/i);
  });

  it('free tier gets the "draft reviewed" closer', () => {
    const prompt = buildAgentSystemPrompt(base({ tier: 'free' }));
    expect(prompt).toMatch(/will be reviewed/i);
    expect(prompt).not.toMatch(/authorized to send directly/i);
  });

  it('pro_automation tier gets the "draft reviewed" closer', () => {
    const prompt = buildAgentSystemPrompt(base({ tier: 'pro_automation' }));
    expect(prompt).toMatch(/will be reviewed/i);
    expect(prompt).not.toMatch(/authorized to send directly/i);
  });

  it('focusListingTitle appears in the prompt when provided', () => {
    const prompt = buildAgentSystemPrompt(
      base({ focusListingTitle: 'Modern 2BR loft near Zona Colonial' }),
    );
    expect(prompt).toContain('Modern 2BR loft near Zona Colonial');
    expect(prompt).toMatch(/FOCUS LISTING/);
  });

  it('focus listing block omitted when focusListingTitle is undefined', () => {
    const prompt = buildAgentSystemPrompt(base());
    expect(prompt).not.toMatch(/FOCUS LISTING/);
  });

  it('tool catalog names all five tools', () => {
    const prompt = buildAgentSystemPrompt(base());
    expect(prompt).toContain('lookup_listing');
    expect(prompt).toContain('find_comparable');
    expect(prompt).toContain('get_agent_availability');
    expect(prompt).toContain('book_viewing');
    expect(prompt).toContain('escalate_to_human');
    expect(prompt).toMatch(/Never fabricate listing details/i);
  });

  it('agent specialties surface in the opener when present', () => {
    const prompt = buildAgentSystemPrompt(base());
    expect(prompt).toContain('Beachfront villas');
    expect(prompt).toContain('Luxury condos');
  });

  it('opener degrades gracefully when bio is null and specialties are empty', () => {
    const prompt = buildAgentSystemPrompt(
      base({
        agent: {
          name: 'Anon Agent',
          languages: ['en'],
          specialties: [],
          bio: null,
        },
      }),
    );
    expect(prompt).toContain('AHO AI assistant on behalf of Anon Agent');
    // Bio + specialties lines should be omitted (no empty placeholders).
    expect(prompt).not.toMatch(/Bio \(for context/);
    expect(prompt).not.toMatch(/specialties:\s*\./i);
  });

  it('universal guardrails ban absolute superlatives and invented facts', () => {
    const prompt = buildAgentSystemPrompt(base());
    expect(prompt).toMatch(/Never invent amenities/i);
    expect(prompt).toMatch(/superlatives/i);
  });

  it('prompt length is between 1500 and 6000 characters', () => {
    const prompt = buildAgentSystemPrompt(base());
    expect(prompt.length).toBeGreaterThanOrEqual(1500);
    expect(prompt.length).toBeLessThanOrEqual(6000);
  });

  it('prompt length stays in budget across the (channel, market, tier) matrix', () => {
    const channels = ['web_chat', 'email', 'whatsapp', 'voice'] as const;
    const markets = ['us', 'es', 'pl', 'pt', 'de', 'fr', 'it'] as const;
    const tiers = ['free', 'pro_automation', 'super_pro', 'agency'] as const;
    for (const channel of channels) {
      for (const market of markets) {
        for (const tier of tiers) {
          const prompt = buildAgentSystemPrompt(
            base({ channel, market, tier, buyerLocale: market === 'us' ? 'en' : market }),
          );
          expect(prompt.length).toBeGreaterThanOrEqual(1500);
          // Ceiling bumped from 5000 → 6000 after Phase-2 follow-up
          // (commit 2026-05-18) added a compact ~400-char ABOUT AHO
          // appendix so the per-agent AI can answer "what is this
          // site?"-style buyer drift questions inline. 6000 chars
          // ≈ ~1500 input tokens; still cheap per-turn.
          expect(prompt.length).toBeLessThanOrEqual(6000);
        }
      }
    }
  });
});
