/**
 * Unit tests for the XML rendering primitives in
 * `src/lib/seo/sitemap-helpers.ts` — used by the per-resource sitemap
 * routes + the master /sitemap.xml index introduced 2026-05-14.
 */

import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  metadataToUrlEntries,
  renderSitemap,
  renderSitemapIndex,
  xmlResponse,
  type UrlEntry,
  type SitemapIndexChild,
} from '@/lib/seo/sitemap-helpers';

describe('sitemap-helpers · escapeXml', () => {
  it('escapes the 5 XML metacharacters', () => {
    expect(escapeXml(`a & b`)).toBe('a &amp; b');
    expect(escapeXml(`<tag>`)).toBe('&lt;tag&gt;');
    expect(escapeXml(`"q"`)).toBe('&quot;q&quot;');
    expect(escapeXml(`it's`)).toBe('it&apos;s');
  });

  it('escape order avoids double-encoding', () => {
    // `&amp;` should NOT become `&amp;amp;`
    expect(escapeXml('a&b<c')).toBe('a&amp;b&lt;c');
  });
});

describe('sitemap-helpers · renderSitemap', () => {
  it('emits a single <url> with required + optional fields', () => {
    const entry: UrlEntry = {
      loc: 'https://advertisehomes.online/en',
      lastmod: new Date('2026-05-14T00:00:00Z'),
      changefreq: 'daily',
      priority: 0.8,
    };
    const xml = renderSitemap([entry]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    );
    expect(xml).toContain('<loc>https://advertisehomes.online/en</loc>');
    expect(xml).toContain('<lastmod>2026-05-14T00:00:00.000Z</lastmod>');
    expect(xml).toContain('<changefreq>daily</changefreq>');
    expect(xml).toContain('<priority>0.8</priority>');
    expect(xml).toMatch(/<\/urlset>\s*$/);
  });

  it('emits hreflang alternates as xhtml:link children', () => {
    const entry: UrlEntry = {
      loc: 'https://advertisehomes.online/en',
      alternates: {
        en: 'https://advertisehomes.online/en',
        es: 'https://advertisehomes.online/es',
        'x-default': 'https://advertisehomes.online/en',
      },
    };
    const xml = renderSitemap([entry]);
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="en" href="https://advertisehomes.online/en" />',
    );
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="es" href="https://advertisehomes.online/es" />',
    );
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://advertisehomes.online/en" />',
    );
  });

  it('skips empty alternate hrefs', () => {
    const entry: UrlEntry = {
      loc: 'https://example.com/x',
      alternates: { en: 'https://example.com/x', es: '' },
    };
    const xml = renderSitemap([entry]);
    expect(xml).toContain('hreflang="en"');
    expect(xml).not.toContain('hreflang="es"');
  });

  it('escapes XML metacharacters in loc + alternate href', () => {
    const entry: UrlEntry = {
      loc: 'https://example.com/x?a=1&b=2',
      alternates: { en: 'https://example.com/y?z=<bad>' },
    };
    const xml = renderSitemap([entry]);
    expect(xml).toContain('<loc>https://example.com/x?a=1&amp;b=2</loc>');
    expect(xml).toContain('href="https://example.com/y?z=&lt;bad&gt;"');
  });

  it('emits an empty <urlset> when given no entries', () => {
    const xml = renderSitemap([]);
    expect(xml).toContain('<urlset');
    expect(xml).toContain('</urlset>');
    expect(xml).not.toContain('<url>');
  });

  it('formats priority to one decimal place', () => {
    const xml = renderSitemap([{ loc: 'x', priority: 1 }]);
    expect(xml).toContain('<priority>1.0</priority>');
    const xml2 = renderSitemap([{ loc: 'x', priority: 0.55 }]);
    expect(xml2).toContain('<priority>0.6</priority>'); // 0.55 → 0.6 by Number.prototype.toFixed
  });
});

describe('sitemap-helpers · renderSitemapIndex', () => {
  it('emits a sitemapindex with child loc + lastmod', () => {
    const children: SitemapIndexChild[] = [
      {
        loc: 'https://advertisehomes.online/sitemap-pages.xml',
        lastmod: new Date('2026-05-14T00:00:00Z'),
      },
      {
        loc: 'https://advertisehomes.online/sitemap-properties.xml',
        lastmod: new Date('2026-05-14T01:30:00Z'),
      },
    ];
    const xml = renderSitemapIndex(children);
    expect(xml).toContain('<?xml');
    expect(xml).toContain(
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain(
      '<loc>https://advertisehomes.online/sitemap-pages.xml</loc>',
    );
    expect(xml).toContain(
      '<loc>https://advertisehomes.online/sitemap-properties.xml</loc>',
    );
    expect(xml).toContain('<lastmod>2026-05-14T01:30:00.000Z</lastmod>');
    expect(xml).toMatch(/<\/sitemapindex>\s*$/);
  });

  it('omits lastmod when not provided', () => {
    const xml = renderSitemapIndex([{ loc: 'https://example.com/sm.xml' }]);
    expect(xml).toContain('<loc>https://example.com/sm.xml</loc>');
    expect(xml).not.toContain('<lastmod>');
  });

  it('escapes ampersands in child loc', () => {
    const xml = renderSitemapIndex([{ loc: 'https://example.com/s.xml?x=1&y=2' }]);
    expect(xml).toContain('https://example.com/s.xml?x=1&amp;y=2');
  });

  it('emits an empty sitemapindex when given no children', () => {
    const xml = renderSitemapIndex([]);
    expect(xml).toContain('<sitemapindex');
    expect(xml).toContain('</sitemapindex>');
    expect(xml).not.toContain('<sitemap>');
  });
});

describe('sitemap-helpers · metadataToUrlEntries', () => {
  it('coerces MetadataRoute.Sitemap entries to UrlEntry shape', () => {
    const out = metadataToUrlEntries([
      {
        url: 'https://example.com/a',
        lastModified: new Date('2026-05-14T00:00:00Z'),
        changeFrequency: 'monthly',
        priority: 0.5,
        alternates: {
          languages: {
            en: 'https://example.com/a',
            es: 'https://example.com/es/a',
          },
        },
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      loc: 'https://example.com/a',
      lastmod: new Date('2026-05-14T00:00:00Z'),
      changefreq: 'monthly',
      priority: 0.5,
      alternates: {
        en: 'https://example.com/a',
        es: 'https://example.com/es/a',
      },
    });
  });

  it('handles string lastModified', () => {
    const out = metadataToUrlEntries([
      { url: 'x', lastModified: '2026-01-02T00:00:00Z' },
    ]);
    expect(out[0]?.lastmod).toEqual(new Date('2026-01-02T00:00:00Z'));
  });

  it('handles missing optional fields', () => {
    const out = metadataToUrlEntries([{ url: 'x' }]);
    expect(out[0]).toEqual({
      loc: 'x',
      lastmod: undefined,
      changefreq: undefined,
      priority: undefined,
      alternates: undefined,
    });
  });
});

describe('sitemap-helpers · xmlResponse', () => {
  it('sets the right content-type + cache headers', async () => {
    const res = xmlResponse('<root/>', 600);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=UTF-8');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=600, s-maxage=1200',
    );
    expect(await res.text()).toBe('<root/>');
  });

  it('defaults to 300s cache when not specified', () => {
    const res = xmlResponse('<root/>');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=300, s-maxage=600',
    );
  });
});
