import { describe, expect, it } from 'vitest';
import { convertCents, COMMON_CURRENCIES, defaultCurrencyForLocale } from '@/lib/currency/rates';

/**
 * Pure-math tests for the FX converter. Network calls + DB cache are
 * exercised end-to-end via smoke-test; these tests pin the math.
 */

const RATES = {
  USD: 1,
  EUR: 0.92,
  DOP: 60.45,
  MXN: 17.8,
  BRL: 5.05,
  GBP: 0.79,
};

describe('convertCents', () => {
  it('returns input unchanged when from === to', () => {
    expect(convertCents(100_00, 'USD', 'USD', RATES)).toBe(100_00);
    expect(convertCents(50_50, 'EUR', 'EUR', RATES)).toBe(50_50);
  });

  it('handles case-insensitive currency codes', () => {
    expect(convertCents(100_00, 'usd', 'EUR', RATES)).toBe(
      convertCents(100_00, 'USD', 'EUR', RATES),
    );
  });

  it('USD → EUR: $100 → ~€92', () => {
    const result = convertCents(100_00, 'USD', 'EUR', RATES);
    expect(result).toBe(9200); // 100 * 0.92 = 92.00 EUR
  });

  it('USD → DOP: $100 → ~6045 DOP', () => {
    const result = convertCents(100_00, 'USD', 'DOP', RATES);
    expect(result).toBe(604500);
  });

  it('EUR → USD: €100 → ~$108.70', () => {
    const result = convertCents(100_00, 'EUR', 'USD', RATES);
    // 10000 / 0.92 = 10869.565...; rounds to 10870
    expect(result).toBe(10870);
  });

  it('cross-rate EUR → DOP via USD: €100 → ~6571 DOP', () => {
    const result = convertCents(100_00, 'EUR', 'DOP', RATES);
    // (10000 / 0.92) * 60.45 = 657065.21...; rounds to 657065
    expect(result).toBe(657065);
  });

  it('returns null for unknown source currency', () => {
    expect(convertCents(100_00, 'ZZZ', 'USD', RATES)).toBeNull();
  });

  it('returns null for unknown target currency', () => {
    expect(convertCents(100_00, 'USD', 'ZZZ', RATES)).toBeNull();
  });

  it('returns null for non-finite rate values (rate corruption)', () => {
    const corrupted = { ...RATES, EUR: NaN };
    expect(convertCents(100_00, 'USD', 'EUR', corrupted)).toBeNull();
  });

  it('returns null for zero rate values (would divide by zero)', () => {
    const zeroRate = { ...RATES, EUR: 0 };
    expect(convertCents(100_00, 'EUR', 'USD', zeroRate)).toBeNull();
  });

  it('preserves zero amounts (e.g., free listings)', () => {
    expect(convertCents(0, 'USD', 'EUR', RATES)).toBe(0);
  });

  it('handles large amounts without overflow (€10M)', () => {
    const result = convertCents(10_000_000_00, 'EUR', 'USD', RATES);
    expect(result).toBeGreaterThan(10_500_000_00);
    expect(result).toBeLessThan(11_500_000_00);
  });
});

describe('COMMON_CURRENCIES', () => {
  it('starts with USD (the default base)', () => {
    expect(COMMON_CURRENCIES[0]).toBe('USD');
  });

  it('includes the LATAM anchor markets', () => {
    expect(COMMON_CURRENCIES).toContain('DOP');
    expect(COMMON_CURRENCIES).toContain('MXN');
    expect(COMMON_CURRENCIES).toContain('BRL');
  });

  it('includes EUR + GBP for European visitors', () => {
    expect(COMMON_CURRENCIES).toContain('EUR');
    expect(COMMON_CURRENCIES).toContain('GBP');
  });
});

describe('defaultCurrencyForLocale', () => {
  it('returns USD for both locales (anchor market is DR — USD-priced)', () => {
    expect(defaultCurrencyForLocale('en')).toBe('USD');
    expect(defaultCurrencyForLocale('es')).toBe('USD');
  });
});
