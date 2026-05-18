/**
 * Unit tests for src/lib/whatsapp/wa-link-builder.ts.
 *
 * Phase 4 of docs/AI_AGENT_PLAN.md. Pure-function tests — no
 * network, no fixtures. We exercise:
 *
 *   - Locale-aware pre-fill text matches the right language string
 *   - URL encoding round-trips correctly through wa.me's expected
 *     `?text=` format
 *   - Phone normalization strips '+' and non-digits
 *   - Listing-short-id hint round-trips through parseWaListingHint
 *   - Hint regex accepts case-insensitive variants
 *   - Missing short id collapses the template token cleanly (no
 *     dangling "{listing}" or double spaces)
 */

import { describe, expect, it } from 'vitest';
import {
  buildWaMeUrl,
  buildWaPrefillText,
  parseWaListingHint,
  AHO_LISTING_HINT_REGEX,
} from '../../src/lib/whatsapp/wa-link-builder';
import type { Locale } from '@/i18n/config';

const ALL_LOCALES: Locale[] = ['en', 'es', 'pl', 'pt', 'de', 'fr', 'it'];

describe('buildWaPrefillText', () => {
  it('substitutes the listing phrase with the short id in every locale', () => {
    for (const locale of ALL_LOCALES) {
      const text = buildWaPrefillText({
        listing_short_id: 'X7K2',
        locale,
      });
      expect(text).toContain('AHO-X7K2');
      // No template placeholder leaked through.
      expect(text).not.toContain('{listing}');
    }
  });

  it('returns localized text matching the locale jargon', () => {
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'en' })).toMatch(
      /interested/i,
    );
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'es' })).toMatch(
      /me interesa/i,
    );
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'pl' })).toMatch(
      /interesuje mnie/i,
    );
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'de' })).toMatch(
      /interessiere mich/i,
    );
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'fr' })).toMatch(
      /intéressé/i,
    );
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'it' })).toMatch(
      /interessat/i,
    );
    expect(buildWaPrefillText({ listing_short_id: 'A1', locale: 'pt' })).toMatch(
      /interesse/i,
    );
  });

  it('collapses the {listing} token cleanly when no short id supplied', () => {
    for (const locale of ALL_LOCALES) {
      const text = buildWaPrefillText({
        listing_short_id: null,
        locale,
      });
      expect(text).not.toContain('{listing}');
      expect(text).not.toContain('AHO-');
      // No double spaces from a sloppy template substitution.
      expect(text).not.toMatch(/ {2,}/);
    }
  });
});

describe('buildWaMeUrl', () => {
  it('produces a wa.me URL with the normalized phone and encoded text', () => {
    const url = buildWaMeUrl({
      phone_e164: '+1 415 555 1212',
      listing_short_id: 'X7K2',
      locale: 'en',
    });
    // Phone normalized: no '+', no spaces.
    expect(url.startsWith('https://wa.me/14155551212?')).toBe(true);
    // Decoding the query roundtrips back to the same prefill text.
    const search = new URL(url).searchParams;
    const text = search.get('text') ?? '';
    expect(text).toContain('AHO-X7K2');
    expect(text).toMatch(/interested/i);
  });

  it('accepts E.164 without the leading +', () => {
    const url = buildWaMeUrl({
      phone_e164: '14155551212',
      locale: 'en',
    });
    expect(url.startsWith('https://wa.me/14155551212?')).toBe(true);
  });

  it('strips non-digit characters from the phone', () => {
    const url = buildWaMeUrl({
      phone_e164: '+1 (415) 555-1212',
      locale: 'en',
    });
    expect(url.startsWith('https://wa.me/14155551212?')).toBe(true);
  });

  it('omits the listing phrase when short id is null', () => {
    const url = buildWaMeUrl({
      phone_e164: '+14155551212',
      listing_short_id: null,
      locale: 'es',
    });
    const text = new URL(url).searchParams.get('text') ?? '';
    expect(text).not.toContain('AHO-');
    expect(text).toMatch(/me interesa/i);
  });

  it('builds a valid URL for every supported locale', () => {
    for (const locale of ALL_LOCALES) {
      const url = buildWaMeUrl({
        phone_e164: '+34666123456',
        listing_short_id: 'ZZZZ',
        locale,
      });
      // Smoke: URL is parseable.
      expect(() => new URL(url)).not.toThrow();
      const text = new URL(url).searchParams.get('text') ?? '';
      expect(text).toContain('AHO-ZZZZ');
    }
  });
});

describe('parseWaListingHint', () => {
  it('extracts a canonical short id', () => {
    expect(parseWaListingHint("Hi I'm interested in listing AHO-X7K2")).toBe(
      'X7K2',
    );
  });

  it('is case-insensitive', () => {
    expect(parseWaListingHint('Hello aho-x7k2 please')).toBe('x7k2');
    expect(parseWaListingHint('Hello Aho-X7K2 please')).toBe('X7K2');
  });

  it('returns null when no hint is present', () => {
    expect(parseWaListingHint('Hi, is this still available?')).toBeNull();
  });

  it('returns the first hint when multiple are present', () => {
    expect(
      parseWaListingHint('Comparing AHO-AAAA and AHO-BBBB'),
    ).toBe('AAAA');
  });

  it('rejects too-short ids (under 4 chars) via the regex bound', () => {
    expect(parseWaListingHint('AHO-12')).toBeNull();
    expect(AHO_LISTING_HINT_REGEX.test('AHO-12')).toBe(false);
  });

  it('round-trips the buildWaPrefillText → parseWaListingHint pair', () => {
    for (const locale of ALL_LOCALES) {
      const text = buildWaPrefillText({
        listing_short_id: 'ABC123',
        locale,
      });
      expect(parseWaListingHint(text)).toBe('ABC123');
    }
  });
});
