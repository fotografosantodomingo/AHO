import { describe, expect, it } from 'vitest';
import {
  assessUniqueValue,
  jaccardSimilarity,
  normalizeForTemplating,
  stripHtml,
  MIN_CONTENT_CHARS,
} from '@/lib/seo/unique-value-contract';

/**
 * Unit tests for the Unique Value Contract guard (docs/SEO_COLD_START_PLAN.md
 * §5/§9). These encode the doorway-page rule so the SEO engine can't scale
 * thin/templated pages that trip Google's scaled-content-abuse policy.
 */

// A long, real-feeling city paragraph so length floors are satisfied; the
// {CITY} marker is swapped per instance.
function richBody(city: string, uniqueFact: string): string {
  return `<h1>Buying property in ${city}</h1><p>${city} is a market with its own
    rhythm. ${uniqueFact} Foreign buyers should budget for transfer taxes and
    notary fees, and account for the time it takes to register title with the
    local land registry. Neighborhood choice matters more here than headline
    price: the difference between a central district and the outskirts can be
    larger than buyers expect, and rental demand is uneven across the city.</p>`;
}

describe('stripHtml', () => {
  it('removes tags and collapses whitespace', () => {
    expect(stripHtml('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });
});

describe('normalizeForTemplating', () => {
  it('neutralizes the entity name but keeps numbers', () => {
    const out = normalizeForTemplating('Median price in Lisbon is 4200 EUR', [
      'Lisbon',
    ]);
    expect(out).not.toContain('lisbon');
    expect(out).toContain('4200');
    expect(out).toContain('■');
  });

  it('neutralizes the longer variant before its substring', () => {
    const out = normalizeForTemplating('Santo Domingo Este is east of Santo Domingo', [
      'Santo Domingo',
      'Santo Domingo Este',
    ]);
    expect(out).not.toContain('santo domingo');
  });
});

describe('jaccardSimilarity', () => {
  it('is 1 for identical token sets', () => {
    expect(jaccardSimilarity('a b c', 'c b a')).toBe(1);
  });
  it('is 0 for disjoint token sets', () => {
    expect(jaccardSimilarity('a b c', 'x y z')).toBe(0);
  });
});

describe('assessUniqueValue', () => {
  it('rejects a page that is too thin', () => {
    const r = assessUniqueValue({ text: '<p>Homes in Tula.</p>', entityNames: ['Tula'] });
    expect(r.passes).toBe(false);
    expect(r.contentChars).toBeLessThan(MIN_CONTENT_CHARS);
    expect(r.reasons.join(' ')).toMatch(/thin/);
  });

  it('rejects pure-template pages that differ only by the place name', () => {
    // Same prose, no differing data — the doorway pattern.
    const template = (city: string) =>
      `<p>Welcome to ${city}. ${city} is a wonderful place to buy property with
       great neighborhoods, friendly people, and excellent investment potential.
       Browse listings in ${city} today and find your dream home in ${city} with
       a trusted local agent who knows the ${city} market inside and out.</p>`;
    const a = { text: template('Lisbon'), entityNames: ['Lisbon'] };
    const b = { text: template('Porto'), entityNames: ['Porto'] };
    const r = assessUniqueValue(a, [b]);
    expect(r.maxSimilarity).toBeGreaterThanOrEqual(0.9);
    expect(r.passes).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/templated|doorway/);
  });

  it('accepts pages with genuinely different content', () => {
    const a = {
      text: richBody(
        'Lisbon',
        'Prices climbed sharply after the golden-visa surge, and the historic Alfama district commands a premium driven by short-term-rental demand.',
      ),
      entityNames: ['Lisbon'],
    };
    const b = {
      text: richBody(
        'Medellín',
        'El Poblado attracts remote workers, while transfer costs and stratified utility tariffs are the quirks foreign buyers underestimate.',
      ),
      entityNames: ['Medellín'],
    };
    const r = assessUniqueValue(a, [b]);
    expect(r.passes).toBe(true);
    expect(r.maxSimilarity).toBeLessThan(0.9);
  });

  it('accepts a rich page with no siblings to compare against', () => {
    const r = assessUniqueValue({
      text: richBody('Santo Domingo', 'The colonial zone and Piantini are very different submarkets.'),
      entityNames: ['Santo Domingo'],
    });
    expect(r.passes).toBe(true);
    expect(r.maxSimilarity).toBe(0);
  });
});
