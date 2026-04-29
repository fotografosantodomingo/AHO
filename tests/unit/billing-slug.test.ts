import { describe, expect, it } from 'vitest';
import { slugifyOrgName } from '../../src/lib/billing/slug';

describe('slugifyOrgName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyOrgName('AHO Realty')).toBe('aho-realty');
  });

  it('strips diacritics from Spanish names', () => {
    expect(slugifyOrgName('Inmobiliaria Núñez')).toBe('inmobiliaria-nunez');
    expect(slugifyOrgName('Bienes Raíces')).toBe('bienes-raices');
  });

  it('drops non-alphanumeric punctuation', () => {
    expect(slugifyOrgName("O'Brien & Co. Realty")).toBe('obrien-co-realty');
    expect(slugifyOrgName('Palmas/Oeste')).toBe('palmasoeste');
  });

  it('collapses runs of hyphens and whitespace', () => {
    expect(slugifyOrgName('Foo --- Bar')).toBe('foo-bar');
    expect(slugifyOrgName('Foo    Bar')).toBe('foo-bar');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifyOrgName('---Foo---')).toBe('foo');
  });

  it('caps at 60 chars', () => {
    const long = 'a'.repeat(120);
    const result = slugifyOrgName(long);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('returns "org" for empty or whitespace-only input', () => {
    expect(slugifyOrgName('')).toBe('org');
    expect(slugifyOrgName('   ')).toBe('org');
    expect(slugifyOrgName('!!!')).toBe('org');
  });

  it('handles unicode that strips to nothing gracefully', () => {
    // Pure CJK names won't have ASCII; should fall back rather than empty.
    expect(slugifyOrgName('東京')).toBe('org');
  });
});
