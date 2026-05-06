import { describe, it, expect } from 'vitest';
import { translatePathForLocale } from '@/lib/auth/translate-path';

/**
 * Re-localizes redirect paths against the PATHNAMES mapping. Used by
 * /auth/callback to land users on the correct locale's destination
 * after auth (templates currently hardcode EN-prefixed `next=...` —
 * see scripts/patch-supabase-email-links.ts).
 */

describe('translatePathForLocale', () => {
  describe('happy paths — known mappings', () => {
    it('maps /en/reset-password → /es/restablecer-contrasena', () => {
      expect(translatePathForLocale('/en/reset-password', 'es')).toBe(
        '/es/restablecer-contrasena',
      );
    });

    it('maps /es/restablecer-contrasena → /en/reset-password', () => {
      expect(translatePathForLocale('/es/restablecer-contrasena', 'en')).toBe(
        '/en/reset-password',
      );
    });

    it('maps /en/dashboard → /es/panel', () => {
      expect(translatePathForLocale('/en/dashboard', 'es')).toBe('/es/panel');
    });

    it('maps /en/pricing → /es/precios', () => {
      expect(translatePathForLocale('/en/pricing', 'es')).toBe('/es/precios');
    });

    it('maps /en/forgot-password → /es/recuperar-contrasena', () => {
      expect(translatePathForLocale('/en/forgot-password', 'es')).toBe(
        '/es/recuperar-contrasena',
      );
    });

    it('maps /en/saved-properties → /es/inmuebles-guardados', () => {
      expect(translatePathForLocale('/en/saved-properties', 'es')).toBe(
        '/es/inmuebles-guardados',
      );
    });
  });

  describe('locale-already-matches → no-op', () => {
    it('returns input when path locale matches target locale', () => {
      expect(translatePathForLocale('/en/dashboard', 'en')).toBe('/en/dashboard');
      expect(translatePathForLocale('/es/panel', 'es')).toBe('/es/panel');
    });
  });

  describe('locale-only paths', () => {
    it('translates /en → /es', () => {
      expect(translatePathForLocale('/en', 'es')).toBe('/es');
    });

    it('translates /en/ → /es', () => {
      expect(translatePathForLocale('/en/', 'es')).toBe('/es');
    });
  });

  describe('unmapped paths — fail-soft to original', () => {
    it('returns input unchanged when the path has no PATHNAMES match (dynamic route)', () => {
      // Dynamic property URLs are not in PATHNAMES with literal slugs;
      // we don't try to guess the translation.
      expect(
        translatePathForLocale(
          '/en/properties/wwww-siemianowice-pl-cQF9BN',
          'es',
        ),
      ).toBe('/en/properties/wwww-siemianowice-pl-cQF9BN');
    });

    it('returns input unchanged for paths without a locale prefix', () => {
      expect(translatePathForLocale('/some-other-path', 'es')).toBe('/some-other-path');
      expect(translatePathForLocale('/', 'es')).toBe('/');
    });

    it('returns input unchanged for paths with an unrecognized prefix', () => {
      expect(translatePathForLocale('/de/dashboard', 'es')).toBe('/de/dashboard');
    });

    it('returns input unchanged when the rest path does not match either locale', () => {
      // E.g. someone hand-crafted a `/en/something-not-in-routes` URL.
      expect(translatePathForLocale('/en/totally-unknown-page', 'es')).toBe(
        '/en/totally-unknown-page',
      );
    });
  });

  describe('safety', () => {
    it('does not throw on weird inputs', () => {
      expect(() => translatePathForLocale('', 'es')).not.toThrow();
      expect(() => translatePathForLocale('//evil.com', 'es')).not.toThrow();
      expect(() => translatePathForLocale('/en//double', 'es')).not.toThrow();
    });

    it('does not turn a same-locale path into something different', () => {
      // Sanity: round-trip stays stable
      const en = '/en/reset-password';
      expect(translatePathForLocale(translatePathForLocale(en, 'es'), 'en')).toBe(en);
    });
  });
});
