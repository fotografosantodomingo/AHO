import { describe, it, expect } from 'vitest';
import { sanitizeNext } from '@/lib/auth/redirect';

/**
 * Open-redirect defense for the `?next=` flow used by /signin and
 * /magic-link. Bug fixed in this batch: the page-level redirect for
 * already-signed-in users was calling `redirect(next ?? `/${locale}`)`
 * with no validation — an attacker could craft `?next=https://evil.com`
 * and bounce victims off-site immediately after auth.
 */

describe('sanitizeNext', () => {
  it('returns the locale home when next is null/undefined/empty', () => {
    expect(sanitizeNext(null, 'en')).toBe('/en');
    expect(sanitizeNext(undefined, 'en')).toBe('/en');
    expect(sanitizeNext('', 'es')).toBe('/es');
  });

  it('passes through a normal relative path', () => {
    expect(sanitizeNext('/dashboard', 'en')).toBe('/dashboard');
    expect(sanitizeNext('/en/properties/abc-xyz', 'en')).toBe(
      '/en/properties/abc-xyz',
    );
  });

  it('blocks absolute external URLs (http and https)', () => {
    expect(sanitizeNext('https://evil.example.com', 'en')).toBe('/en');
    expect(sanitizeNext('http://evil.example.com/path', 'en')).toBe('/en');
  });

  it('blocks protocol-relative URLs (//evil.com)', () => {
    expect(sanitizeNext('//evil.example.com', 'en')).toBe('/en');
    expect(sanitizeNext('//evil.example.com/path', 'es')).toBe('/es');
  });

  it('blocks javascript: and data: URIs', () => {
    expect(sanitizeNext('javascript:alert(1)', 'en')).toBe('/en');
    expect(sanitizeNext('data:text/html,evil', 'en')).toBe('/en');
  });

  it('blocks paths that do not start with a slash', () => {
    expect(sanitizeNext('dashboard', 'en')).toBe('/en');
    expect(sanitizeNext('en/dashboard', 'en')).toBe('/en');
  });

  it('uses the active locale for the fallback', () => {
    expect(sanitizeNext(null, 'en')).toBe('/en');
    expect(sanitizeNext(null, 'es')).toBe('/es');
    expect(sanitizeNext('//attacker', 'es')).toBe('/es');
  });

  it('preserves query strings and fragments on safe paths', () => {
    expect(sanitizeNext('/search?q=beach&page=2', 'en')).toBe(
      '/search?q=beach&page=2',
    );
    expect(sanitizeNext('/properties/abc#gallery', 'en')).toBe(
      '/properties/abc#gallery',
    );
  });
});
