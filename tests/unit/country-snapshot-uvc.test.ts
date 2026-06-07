import { describe, expect, it } from 'vitest';
import { assessUniqueValue } from '@/lib/seo/unique-value-contract';

/**
 * Phase 1 Unique Value Contract check (docs/SEO_COLD_START_PLAN.md §5/§9):
 * the flagship country-hub pages must NOT be doorway pages. This asserts the
 * snapshot CONTENT DESIGN passes the contract — each page has enough real
 * content, and no two are near-duplicates once the page's primary subject
 * (the country name) is neutralized. Capital + real figures are legitimate
 * distinguishing content and are intentionally NOT neutralized.
 *
 * `snapshotContent` mirrors what the country page renders: the EN
 * economicIntro template (messages/en.json countryLanding.economicIntro) +
 * the indicators block + the capital CTA. Values are real figures from the
 * knowledge graph (REST Countries + World Bank, the same numbers the page
 * shows). The hardest case is the EUR trio (ES/PT/IT — same currency AND
 * region), which is exactly why this test exists.
 */

interface CountryVars {
  country: string;
  capital: string;
  population: string;
  gdp: string;
  gdpYear: string;
  currency: string;
}

function intro(v: CountryVars): string {
  return (
    `${v.country} has a population of ${v.population} and a GDP per capita of ` +
    `${v.gdp} as of ${v.gdpYear}. Its capital is ${v.capital}, and property is ` +
    `typically priced in ${v.currency}. Explore real estate across ${v.country} ` +
    `and connect with local agents on AHO.`
  );
}

function snapshotContent(v: CountryVars): string {
  return [
    intro(v),
    `GDP per capita ${v.gdp}`,
    `Currency ${v.currency}`,
    `Capital ${v.capital}`,
    `Population ${v.population}`,
    `Explore real estate in ${v.capital}`,
  ].join(' ');
}

const COUNTRIES: CountryVars[] = [
  { country: 'Dominican Republic', capital: 'Santo Domingo', population: '10,771,504', gdp: '$10,876', gdpYear: '2024', currency: 'DOP' },
  { country: 'Spain', capital: 'Madrid', population: '47,519,628', gdp: '$33,090', gdpYear: '2024', currency: 'EUR' },
  { country: 'Portugal', capital: 'Lisbon', population: '10,305,564', gdp: '$27,353', gdpYear: '2024', currency: 'EUR' },
  { country: 'Italy', capital: 'Rome', population: '59,554,023', gdp: '$39,003', gdpYear: '2024', currency: 'EUR' },
  { country: 'Mexico', capital: 'Mexico City', population: '128,932,753', gdp: '$13,790', gdpYear: '2024', currency: 'MXN' },
  { country: 'Colombia', capital: 'Bogotá', population: '50,882,884', gdp: '$6,947', gdpYear: '2024', currency: 'COP' },
  { country: 'Costa Rica', capital: 'San José', population: '5,094,114', gdp: '$13,365', gdpYear: '2024', currency: 'CRC' },
  { country: 'Thailand', capital: 'Bangkok', population: '71,601,103', gdp: '$7,180', gdpYear: '2024', currency: 'THB' },
];

describe('country snapshot — Unique Value Contract', () => {
  // entityNames = [country] only: the country is the page's primary subject;
  // the capital + figures are real distinguishing content.
  const inputs = COUNTRIES.map((c) => ({
    text: snapshotContent(c),
    entityNames: [c.country],
  }));

  it('every flagship snapshot clears the real-content floor', () => {
    for (const inp of inputs) {
      const r = assessUniqueValue(inp);
      expect(r.contentChars).toBeGreaterThanOrEqual(250);
    }
  });

  it('no two flagship snapshots are doorway duplicates (incl. the EUR trio)', () => {
    inputs.forEach((inp, i) => {
      const others = inputs.filter((_, j) => j !== i);
      const r = assessUniqueValue(inp, others);
      expect(r.passes, `${COUNTRIES[i]?.country}: ${r.reasons.join('; ')}`).toBe(true);
      expect(r.maxSimilarity).toBeLessThan(0.9);
    });
  });
});
