/**
 * Unit tests for `src/lib/voice/voice-prompts.ts`.
 *
 * Pure-function tests — no network, no fixtures. Validates:
 *   - ≤15-word constraint per sentence (TTS fits one buffer)
 *   - Locale-aware language (greeting in buyer's language)
 *   - Mentions focus listing when provided
 *   - Includes agent first name (parasocial trust signal)
 *   - No markdown (TTS reads asterisks aloud literally)
 *   - Degrades gracefully when first name is missing
 */

import { describe, expect, it } from 'vitest';
import {
  buildVoiceGreeting,
  buildTransferPreamble,
  buildClarifyRequest,
  type VoiceLocale,
} from '@/lib/voice/voice-prompts';

const ALL_LOCALES: VoiceLocale[] = ['en', 'es', 'pl', 'pt', 'de', 'fr', 'it'];

/** Split on sentence-ending punctuation; trim empties. */
function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => w.length > 0).length;
}

describe('buildVoiceGreeting', () => {
  it('English generic greeting names the agent + asks how to help', () => {
    const g = buildVoiceGreeting({ agent: { firstName: 'Maria' }, buyerLocale: 'en' });
    expect(g).toContain('Maria');
    expect(g).toContain('AI assistant');
    expect(g.toLowerCase()).toContain('help');
  });

  it('English greeting with focus listing names the listing', () => {
    const g = buildVoiceGreeting({
      agent: { firstName: 'Maria' },
      buyerLocale: 'en',
      focusListing: { title: 'the villa in Santo Domingo' },
    });
    expect(g).toContain('Maria');
    expect(g).toContain('the villa in Santo Domingo');
  });

  it.each([
    { locale: 'es', token: 'asistente' },
    { locale: 'pl', token: 'asystent' },
    { locale: 'pt', token: 'assistente' },
    { locale: 'de', token: 'Assistent' },
    { locale: 'fr', token: 'assistant' },
    { locale: 'it', token: 'assistente' },
  ] as const)(
    'locale=$locale uses the language-native "assistant" word ($token)',
    ({ locale, token }) => {
      const g = buildVoiceGreeting({ agent: { firstName: 'Maria' }, buyerLocale: locale });
      expect(g).toContain(token);
    },
  );

  it('every locale honors the ≤15-word per-sentence constraint (generic greeting)', () => {
    for (const locale of ALL_LOCALES) {
      const g = buildVoiceGreeting({ agent: { firstName: 'Maria' }, buyerLocale: locale });
      const sentences = sentencesOf(g);
      expect(sentences.length).toBeGreaterThanOrEqual(1);
      for (const sentence of sentences) {
        expect(wordCount(sentence), `locale=${locale} sentence too long: "${sentence}"`).toBeLessThanOrEqual(15);
      }
    }
  });

  it('every locale honors the ≤15-word constraint with a focus listing', () => {
    for (const locale of ALL_LOCALES) {
      const g = buildVoiceGreeting({
        agent: { firstName: 'Maria' },
        buyerLocale: locale,
        focusListing: { title: 'the villa' },
      });
      const sentences = sentencesOf(g);
      for (const sentence of sentences) {
        expect(wordCount(sentence), `locale=${locale} sentence too long: "${sentence}"`).toBeLessThanOrEqual(15);
      }
    }
  });

  it('contains no markdown characters (TTS would read them aloud)', () => {
    for (const locale of ALL_LOCALES) {
      const g = buildVoiceGreeting({
        agent: { firstName: 'Maria' },
        buyerLocale: locale,
        focusListing: { title: 'the villa' },
      });
      // No asterisks, underscores, backticks, brackets.
      expect(g).not.toMatch(/[*_`[\]<>{}]/);
    }
  });

  it('degrades gracefully when first name is empty', () => {
    const g = buildVoiceGreeting({ agent: { firstName: '' }, buyerLocale: 'en' });
    // Falls back to "the agent" (or locale equivalent) — no empty
    // possessive like " 's AI assistant".
    expect(g).not.toMatch(/^\s+'s/);
    expect(g.length).toBeGreaterThan(20);
  });

  it('degrades gracefully when first name is whitespace', () => {
    const g = buildVoiceGreeting({ agent: { firstName: '   ' }, buyerLocale: 'en' });
    expect(g).toContain('the agent');
  });

  it('focus-listing variant differs from generic variant for every locale', () => {
    for (const locale of ALL_LOCALES) {
      const generic = buildVoiceGreeting({ agent: { firstName: 'Maria' }, buyerLocale: locale });
      const focused = buildVoiceGreeting({
        agent: { firstName: 'Maria' },
        buyerLocale: locale,
        focusListing: { title: 'the villa' },
      });
      expect(focused).not.toBe(generic);
      expect(focused).toContain('the villa');
    }
  });

  it('unknown locales fall through to English', () => {
    // @ts-expect-error — exercising the default branch
    const g = buildVoiceGreeting({ agent: { firstName: 'Maria' }, buyerLocale: 'xx' });
    expect(g).toContain('AI assistant');
  });
});

describe('buildTransferPreamble', () => {
  it('every locale produces ≤15 words per sentence', () => {
    for (const locale of ALL_LOCALES) {
      const t = buildTransferPreamble(locale, 'Maria');
      for (const s of sentencesOf(t)) {
        expect(wordCount(s)).toBeLessThanOrEqual(15);
      }
    }
  });

  it('every locale references the agent name', () => {
    for (const locale of ALL_LOCALES) {
      const t = buildTransferPreamble(locale, 'Maria');
      expect(t).toContain('Maria');
    }
  });

  it('falls back to "the agent" when first name is empty', () => {
    const t = buildTransferPreamble('en', '');
    expect(t).toContain('the agent');
  });
});

describe('buildClarifyRequest', () => {
  it('every locale produces ≤15 words per sentence', () => {
    for (const locale of ALL_LOCALES) {
      const t = buildClarifyRequest(locale);
      for (const s of sentencesOf(t)) {
        expect(wordCount(s)).toBeLessThanOrEqual(15);
      }
    }
  });

  it('every locale is non-empty', () => {
    for (const locale of ALL_LOCALES) {
      expect(buildClarifyRequest(locale).length).toBeGreaterThan(10);
    }
  });
});
