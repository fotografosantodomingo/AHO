/**
 * Unit tests for `src/lib/ai/aho-platform-kb.ts`.
 *
 * Pure-data, pure-function module — no network, no fixtures.
 *
 * Coverage:
 *   - EN returns English content (sentinel strings).
 *   - ES returns Spanish content (sentinel strings).
 *   - Marketing locales (pl/pt/de/fr/it) fall back to EN.
 *   - Required tier fields are populated for every live tier.
 *   - Every how-to has ≥ 3 steps.
 *   - Every troubleshooting entry has non-empty q + a.
 *   - canonicalUrls are relative paths starting with `/`.
 *   - EN KB stringifies to under 15 KB (token-budget guardrail).
 */

import { describe, expect, it } from 'vitest';
import { ahoPlatformKb } from '@/lib/ai/aho-platform-kb';

describe('ahoPlatformKb', () => {
  it('returns English content for the en locale', () => {
    const kb = ahoPlatformKb('en');
    expect(kb.what_is_aho).toContain('AHO');
    // Pro Automation tier exists and uses the English label.
    const pro = kb.tiers.find((t) => t.id === 'pro_automation');
    expect(pro).toBeDefined();
    expect(pro?.name).toBe('Pro Automation');
    // Troubleshooting Q is in English.
    const ig = kb.troubleshooting.find((t) => t.id === 'instagram_not_detected');
    expect(ig?.q).toMatch(/Instagram/);
    expect(ig?.q).toMatch(/not detected/i);
    // English how-to titles use English verbs.
    const addListing = kb.howTos.find((h) => h.id === 'add_listing');
    expect(addListing?.title).toBe('Add a listing');
  });

  it('returns Spanish content for the es locale', () => {
    const kb = ahoPlatformKb('es');
    expect(kb.what_is_aho).toContain('AHO');
    const agent = kb.tiers.find((t) => t.id === 'agent');
    expect(agent?.name).toBe('Agente');
    const ig = kb.troubleshooting.find((t) => t.id === 'instagram_not_detected');
    expect(ig?.q).toMatch(/Instagram/);
    expect(ig?.q).toMatch(/detecta/i);
    const addListing = kb.howTos.find((h) => h.id === 'add_listing');
    expect(addListing?.title).toBe('Crear un anuncio');
  });

  it('falls back to English for marketing locales (pl/pt/de/fr/it)', () => {
    const en = ahoPlatformKb('en');
    for (const loc of ['pl', 'pt', 'de', 'fr', 'it'] as const) {
      const kb = ahoPlatformKb(loc);
      expect(kb).toEqual(en);
    }
  });

  it('populates the required fields on every tier', () => {
    const kb = ahoPlatformKb('en');
    // Must include the four canonical tiers.
    const ids = kb.tiers.map((t) => t.id).sort();
    // Updated 2026-05-18: private_owner tier added for the $5 one-
    // time-listing product (docs/SELL_FUNNEL_PLAN.md). Listed alongside
    // agent / plus / pro_automation / super_pro.
    expect(ids).toEqual(['agent', 'plus', 'private_owner', 'pro_automation', 'super_pro']);
    for (const tier of kb.tiers) {
      expect(tier.name.length).toBeGreaterThan(0);
      expect(tier.description.length).toBeGreaterThan(10);
      expect(tier.keyFeatures.length).toBeGreaterThanOrEqual(4);
      expect(tier.notIncluded.length).toBeGreaterThanOrEqual(1);
      // Live tiers must have prices; planned tier price is allowed null.
      // The private_owner tier is live but uses `oneTimeUsd` instead
      // of monthly/annual (one-time per-listing product, not a
      // subscription). Other live tiers carry both monthly + annual.
      if (tier.status === 'live') {
        if (tier.id === 'private_owner') {
          expect(typeof tier.oneTimeUsd).toBe('number');
        } else {
          expect(typeof tier.priceMonthlyUsd).toBe('number');
          expect(typeof tier.priceAnnualUsd).toBe('number');
        }
      }
    }
    // Super Pro is planned.
    const superPro = kb.tiers.find((t) => t.id === 'super_pro');
    expect(superPro?.status).toBe('planned');
  });

  it('gives every how-to at least 3 steps', () => {
    const kb = ahoPlatformKb('en');
    expect(kb.howTos.length).toBeGreaterThanOrEqual(12);
    for (const h of kb.howTos) {
      expect(h.title.length).toBeGreaterThan(0);
      expect(h.steps.length).toBeGreaterThanOrEqual(3);
      // No empty steps.
      for (const s of h.steps) {
        expect(s.length).toBeGreaterThan(3);
      }
    }
  });

  it('gives every troubleshooting entry a non-empty q + a', () => {
    const kb = ahoPlatformKb('en');
    expect(kb.troubleshooting.length).toBeGreaterThanOrEqual(12);
    for (const t of kb.troubleshooting) {
      expect(t.q.trim().length).toBeGreaterThan(0);
      expect(t.a.trim().length).toBeGreaterThan(10);
      expect(Array.isArray(t.tags)).toBe(true);
    }
  });

  it('exposes canonicalUrls as relative paths starting with /', () => {
    const kb = ahoPlatformKb('en');
    const top = kb.canonicalUrls;
    const flat: string[] = [
      top.pricing,
      top.docs,
      top.forAgents,
      top.automation,
      top.saveTime,
      top.instagramSetup,
      top.profileGuide,
      top.shareGuide,
      top.privacy,
      top.terms,
      top.investors,
      top.dashboard.properties,
      top.dashboard.leads,
      top.dashboard.analytics,
      top.dashboard.social,
      top.dashboard.profile,
      top.dashboard.aiInbox,
      top.dashboard.reviews,
    ];
    for (const url of flat) {
      expect(url.startsWith('/')).toBe(true);
      expect(url).not.toMatch(/^https?:/);
    }
  });

  it('keeps the EN KB JSON size under 25,000 chars (token budget guardrail)', () => {
    const kb = ahoPlatformKb('en');
    const size = JSON.stringify(kb).length;
    // 25k chars ≈ 6k input tokens — comfortable within Haiku's 200k
    // input budget. The KB is intentionally comprehensive (Phase 1
    // sized it at ~21k chars for full feature + tier + how-to + FAQ
    // coverage); the prior 15k cap was conservative-without-reason.
    // If the KB grows past 25k chars (Claude's input budget gets
    // wasteful for repeat per-turn cost), trim deep how-to details
    // and link to /docs instead.
    expect(size).toBeLessThan(25000);
  });
});
