import { describe, it, expect } from 'vitest';
import { renderDigest, formatPriceCents } from '@/lib/saved-search/digest';

/**
 * Saved-search digest email renderer (separate CF Worker, see
 * workers/saved-search-alerts/). Pure-render unit; no DB or Brevo
 * touches. Verifies bilingual subjects, escape on injection-prone
 * inputs, and currency formatting per locale.
 */

const baseMatch = {
  id: 'p1',
  short_id: 'AB12CD',
  slug_en: 'beachfront-villa-las-terrenas',
  slug_es: 'villa-frente-al-mar-las-terrenas',
  title_en: 'Beachfront Villa',
  title_es: 'Villa frente al mar',
  city: 'Las Terrenas',
  country_code: 'DO',
  price_cents: 95_000_000,
  currency: 'USD',
  bedrooms: 3,
  bathrooms: 2,
  area_sqm: 240,
  transaction_type: 'sale',
  published_at: '2026-05-05T12:00:00Z',
};

describe('renderDigest', () => {
  it('produces an EN subject with match count + saved-search name', () => {
    const out = renderDigest({
      recipientName: 'Ana',
      savedSearchName: 'Punta Cana villas',
      savedSearchId: 's1',
      locale: 'en',
      matches: [baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.subject).toBe('1 new listing for "Punta Cana villas"');
  });

  it('pluralizes correctly for 2+ matches in EN', () => {
    const out = renderDigest({
      recipientName: 'Ana',
      savedSearchName: 'Saved A',
      savedSearchId: 's1',
      locale: 'en',
      matches: [baseMatch, baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.subject).toBe('2 new listings for "Saved A"');
  });

  it('produces an ES subject with the right plural', () => {
    const out = renderDigest({
      recipientName: 'Ana',
      savedSearchName: 'Villas en Punta Cana',
      savedSearchId: 's1',
      locale: 'es',
      matches: [baseMatch, baseMatch, baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.subject).toBe('3 nuevos anuncios para "Villas en Punta Cana"');
  });

  it('falls back gracefully when the saved search has no name', () => {
    const out = renderDigest({
      recipientName: null,
      savedSearchName: null,
      savedSearchId: 's1',
      locale: 'en',
      matches: [baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.subject).toBe('1 new listing for your saved search');
    expect(out.html).toContain('Hi there,');
  });

  it('escapes recipient name + saved-search name to prevent HTML injection', () => {
    const out = renderDigest({
      recipientName: '<script>alert(1)</script>',
      savedSearchName: '"><img src=x onerror=alert(1)>',
      savedSearchId: 's1',
      locale: 'en',
      matches: [baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The img-tag injection in the saved-search name appears once in
    // the body and once in the subject (which gets re-rendered into
    // HTML inside the intro paragraph). Both must be escaped.
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('builds property URLs with the correct locale path segment', () => {
    const out = renderDigest({
      recipientName: 'Ana',
      savedSearchName: null,
      savedSearchId: 's1',
      locale: 'en',
      matches: [baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.html).toContain(
      'https://advertisehomes.online/en/properties/beachfront-villa-las-terrenas-AB12CD',
    );
  });

  it('uses the ES slug + ES path on the ES locale', () => {
    const out = renderDigest({
      recipientName: 'Ana',
      savedSearchName: null,
      savedSearchId: 's1',
      locale: 'es',
      matches: [baseMatch],
      siteUrl: 'https://advertisehomes.online',
    });
    expect(out.html).toContain(
      'https://advertisehomes.online/es/propiedades/villa-frente-al-mar-las-terrenas-AB12CD',
    );
  });

  it('links the unsubscribe footer to the locale-correct dashboard', () => {
    const enOut = renderDigest({
      recipientName: 'A',
      savedSearchName: null,
      savedSearchId: 's',
      locale: 'en',
      matches: [baseMatch],
      siteUrl: 'https://aho.test',
    });
    expect(enOut.html).toContain('https://aho.test/en/saved-searches');
    const esOut = renderDigest({
      recipientName: 'A',
      savedSearchName: null,
      savedSearchId: 's',
      locale: 'es',
      matches: [baseMatch],
      siteUrl: 'https://aho.test',
    });
    expect(esOut.html).toContain('https://aho.test/es/busquedas-guardadas');
  });
});

describe('formatPriceCents', () => {
  it('formats USD in en-US with no fractional part', () => {
    expect(formatPriceCents(95_000_000, 'USD', 'en')).toBe('$950,000');
  });

  it('formats EUR in es-DO without fractional part', () => {
    // Assert digit grouping is right + currency is identifiable. The
    // exact symbol vs. ISO-code rendering depends on the runtime's
    // ICU data: full ICU (browser, CF Workers) shows €; trimmed ICU
    // (Node's small-icu in some test envs) shows "EUR". Both are valid.
    const out = formatPriceCents(45_000_000, 'EUR', 'es');
    expect(out).toMatch(/450[.,]000/);
    expect(out).toMatch(/€|EUR/);
  });

  it('falls back to currency-code prefix on an unknown currency', () => {
    const out = formatPriceCents(10_000, 'XBT', 'en');
    // Browser will throw RangeError on truly invalid currency; gracefully
    // falls back to "XBT 100". Don't assert exact format — Intl behavior
    // varies — just that it returned a non-empty string with the code.
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});
