import { describe, it, expect } from 'vitest';
import {
  buildAllLocaleAlternates,
  buildContentAlternates,
  buildMarketingChromeEntries,
  localeUrl,
  maxDate,
  MARKETING_LASTMOD,
  MARKETING_PATH_KEYS,
} from '@/lib/seo/sitemap-helpers';
import { LOCALES } from '@/i18n/config';

const SITE = 'https://advertisehomes.online';

/**
 * Sitemap composition helpers — the non-DB portion of the sitemap
 * route. Cover hreflang assembly across both locale tiers (7-locale
 * marketing chrome vs EN/ES content) plus the lastmod precision
 * helpers.
 */

describe('sitemap-helpers / localeUrl', () => {
  it('emits the localized path for /pricing in Spanish', () => {
    expect(
      localeUrl({ siteUrl: SITE, locale: 'es', pathKey: '/pricing' }),
    ).toBe(`${SITE}/es/precios`);
  });

  it('keeps the EN path on marketing-only locales (PL/PT/DE/FR/IT)', () => {
    // /pricing is not localized for the marketing locales — it stays
    // English. Per i18n/config.ts comment about en5() spread.
    for (const locale of ['pl', 'pt', 'de', 'fr', 'it'] as const) {
      expect(
        localeUrl({ siteUrl: SITE, locale, pathKey: '/pricing' }),
      ).toBe(`${SITE}/${locale}/pricing`);
    }
  });

  it('emits per-locale slugs for the agent-acquisition landings', () => {
    expect(
      localeUrl({ siteUrl: SITE, locale: 'pl', pathKey: '/for-agents' }),
    ).toBe(`${SITE}/pl/dla-agentow`);
    expect(
      localeUrl({ siteUrl: SITE, locale: 'de', pathKey: '/save-time' }),
    ).toBe(`${SITE}/de/zeit-sparen`);
  });

  it('returns the bare locale URL for the root path', () => {
    expect(localeUrl({ siteUrl: SITE, locale: 'en', pathKey: '/' })).toBe(
      `${SITE}/en`,
    );
  });
});

describe('sitemap-helpers / buildAllLocaleAlternates', () => {
  it('produces one entry per locale plus x-default pointing at EN', () => {
    const langs = buildAllLocaleAlternates({
      siteUrl: SITE,
      pathKey: '/pricing',
    });
    expect(Object.keys(langs).sort()).toEqual(
      [...LOCALES, 'x-default'].sort(),
    );
    expect(langs['x-default']).toBe(langs.en);
    expect(langs.en).toBe(`${SITE}/en/pricing`);
    expect(langs.es).toBe(`${SITE}/es/precios`);
    expect(langs.pl).toBe(`${SITE}/pl/pricing`);
  });

  it('produces translated slugs for /for-agents in every locale', () => {
    const langs = buildAllLocaleAlternates({
      siteUrl: SITE,
      pathKey: '/for-agents',
    });
    expect(langs.en).toBe(`${SITE}/en/for-agents`);
    expect(langs.es).toBe(`${SITE}/es/para-agentes`);
    expect(langs.pl).toBe(`${SITE}/pl/dla-agentow`);
    expect(langs.pt).toBe(`${SITE}/pt/para-agentes-imobiliarios`);
    expect(langs.de).toBe(`${SITE}/de/fuer-makler`);
    expect(langs.fr).toBe(`${SITE}/fr/pour-agents`);
    expect(langs.it).toBe(`${SITE}/it/per-agenti`);
  });
});

describe('sitemap-helpers / buildContentAlternates', () => {
  it('emits both languages with x-default = EN when both URLs supplied', () => {
    const langs = buildContentAlternates({
      enUrl: `${SITE}/en/properties/foo-AB12CD`,
      esUrl: `${SITE}/es/propiedades/foo-AB12CD`,
    });
    expect(langs).toEqual({
      en: `${SITE}/en/properties/foo-AB12CD`,
      es: `${SITE}/es/propiedades/foo-AB12CD`,
      'x-default': `${SITE}/en/properties/foo-AB12CD`,
    });
  });

  it('falls back to ES for x-default when EN slug is missing (single-language listing)', () => {
    const langs = buildContentAlternates({
      enUrl: null,
      esUrl: `${SITE}/es/propiedades/casa-en-la-romana-XYZ123`,
    });
    expect(langs).toEqual({
      es: `${SITE}/es/propiedades/casa-en-la-romana-XYZ123`,
      'x-default': `${SITE}/es/propiedades/casa-en-la-romana-XYZ123`,
    });
    expect(langs.en).toBeUndefined();
  });

  it('returns an empty map when neither URL is provided', () => {
    const langs = buildContentAlternates({ enUrl: null, esUrl: null });
    expect(langs).toEqual({});
  });
});

describe('sitemap-helpers / buildMarketingChromeEntries', () => {
  it('emits one entry per page per locale (6 pages * 7 locales = 42)', () => {
    const entries = buildMarketingChromeEntries({ siteUrl: SITE });
    expect(entries.length).toBe(MARKETING_PATH_KEYS.length * LOCALES.length);
    // 6 marketing pages (homepage + /pricing + /privacy + /terms +
    // /countries + /docs) × 7 locales = 42.
    expect(entries.length).toBe(42);
  });

  it('uses the fixed MARKETING_LASTMOD constant by default (no per-request churn)', () => {
    const entries = buildMarketingChromeEntries({ siteUrl: SITE });
    for (const entry of entries) {
      expect(entry.lastModified).toEqual(MARKETING_LASTMOD);
    }
  });

  it('every entry carries hreflang for all 7 locales + x-default', () => {
    const entries = buildMarketingChromeEntries({ siteUrl: SITE });
    for (const entry of entries) {
      const langs = entry.alternates?.languages ?? {};
      const keys = Object.keys(langs).sort();
      expect(keys).toEqual([...LOCALES, 'x-default'].sort());
    }
  });

  it('sets priority=1.0 for the homepage and 0.7 for /pricing', () => {
    const entries = buildMarketingChromeEntries({ siteUrl: SITE });
    const home = entries.find((e) => e.url === `${SITE}/en`);
    const pricing = entries.find((e) => e.url === `${SITE}/en/pricing`);
    expect(home?.priority).toBe(1.0);
    expect(pricing?.priority).toBe(0.7);
  });
});

describe('sitemap-helpers / maxDate', () => {
  it('returns the latest of a mixed Date / ISO-string / null input', () => {
    const result = maxDate([
      '2026-01-01T00:00:00Z',
      new Date('2026-05-01T12:00:00Z'),
      null,
      undefined,
      '2026-03-15T00:00:00Z',
    ]);
    expect(result?.toISOString()).toBe('2026-05-01T12:00:00.000Z');
  });

  it('returns null when nothing valid is supplied', () => {
    expect(maxDate([])).toBeNull();
    expect(maxDate([null, undefined])).toBeNull();
    expect(maxDate(['not a date', null])).toBeNull();
  });

  it('skips invalid date strings rather than poisoning the max', () => {
    const result = maxDate(['garbage', '2026-04-01T00:00:00Z']);
    expect(result?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });
});
