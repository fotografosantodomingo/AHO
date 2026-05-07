import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  condense,
  detectBotBlock,
  fetchPage,
  isInternalHost,
  importFromUrl,
} from '@/lib/listings/import-from-url';

/**
 * Tests focus on the parts BEFORE the network/LLM call:
 *   - SSRF guard (`isInternalHost`)
 *   - Bot-block detection (`detectBotBlock`)
 *   - HTML condensation (`condense`)
 *   - Streaming body cap inside `fetchPage`
 *
 * We mock global fetch so no real network is touched and assertions
 * stay deterministic.
 */

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('isInternalHost', () => {
  it('rejects localhost + RFC1918 + link-local', () => {
    for (const h of [
      'localhost',
      'LOCALHOST',
      '127.0.0.1',
      '127.42.0.1',
      '10.0.0.1',
      '192.168.1.10',
      '169.254.169.254',
    ]) {
      expect(isInternalHost(h)).toBe(true);
    }
  });

  it('allows public hostnames', () => {
    for (const h of [
      'www.otodom.pl',
      'idealista.com',
      'zillow.com',
      '8.8.8.8',
      // 100.x is reserved (CGNAT) but our guard only blocks the obvious
      // ones — documenting current behavior.
      '100.64.0.1',
    ]) {
      expect(isInternalHost(h)).toBe(false);
    }
  });
});

describe('importFromUrl SSRF guard', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('rejects internal URLs before any fetch happens', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    await expect(
      importFromUrl({ url: 'http://localhost:3000/listing/1' }),
    ).rejects.toThrow(/internal address/i);
    await expect(
      importFromUrl({ url: 'http://192.168.1.1/listing/1' }),
    ).rejects.toThrow(/internal address/i);
    await expect(
      importFromUrl({ url: 'http://169.254.169.254/latest/meta-data/' }),
    ).rejects.toThrow(/internal address/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) protocols', async () => {
    await expect(
      importFromUrl({ url: 'file:///etc/passwd' }),
    ).rejects.toThrow(/http or https/i);
    await expect(
      importFromUrl({ url: 'ftp://example.com/listing' }),
    ).rejects.toThrow(/http or https/i);
  });

  it('rejects malformed URLs', async () => {
    await expect(importFromUrl({ url: 'not-a-url' })).rejects.toThrow(/Invalid URL/i);
  });
});

describe('detectBotBlock', () => {
  const longBody = 'x'.repeat(50_000);
  const longBodyHead = longBody.slice(0, 4_000);

  function makeHeaders(init: Record<string, string> = {}): Headers {
    return new Headers(init);
  }

  it('flags AWS WAF challenge headers', () => {
    expect(
      detectBotBlock({
        status: 202,
        headers: makeHeaders({ 'x-amzn-waf-action': 'challenge' }),
        bodyBytes: longBody.length,
        bodyHead: longBodyHead,
      }),
    ).toMatch(/AWS WAF/i);
  });

  it('flags AWS WAF captcha headers', () => {
    expect(
      detectBotBlock({
        status: 200,
        headers: makeHeaders({ 'x-amzn-waf-action': 'captcha' }),
        bodyBytes: longBody.length,
        bodyHead: longBodyHead,
      }),
    ).toMatch(/AWS WAF/i);
  });

  it('flags Cloudflare challenge headers', () => {
    expect(
      detectBotBlock({
        status: 200,
        headers: makeHeaders({ 'cf-mitigated': 'challenge' }),
        bodyBytes: longBody.length,
        bodyHead: longBodyHead,
      }),
    ).toMatch(/Cloudflare/i);
  });

  it('flags HTTP 202 with an empty body as a bot challenge', () => {
    expect(
      detectBotBlock({
        status: 202,
        headers: makeHeaders(),
        bodyBytes: 0,
        bodyHead: '',
      }),
    ).toMatch(/HTTP 202/i);
  });

  it('flags tiny bodies (under MIN_BODY_BYTES_FOR_REAL_PAGE)', () => {
    expect(
      detectBotBlock({
        status: 200,
        headers: makeHeaders(),
        bodyBytes: 1_500,
        bodyHead: '<html></html>',
      }),
    ).toMatch(/empty|tiny/i);
  });

  it('flags body markers like "attention required" / DataDome / PX', () => {
    for (const marker of [
      '<title>Attention Required! | Cloudflare</title>',
      '<div id="px-captcha"></div>',
      '<script>window.datadome = "..."</script>',
      '<html><body>akamai-challenge</body></html>',
      '{"reason":"access denied"}',
    ]) {
      expect(
        detectBotBlock({
          status: 200,
          headers: makeHeaders(),
          bodyBytes: longBody.length,
          bodyHead: marker + longBodyHead,
        }),
      ).toMatch(/bot-challenge/i);
    }
  });

  it('returns null for a normal page', () => {
    expect(
      detectBotBlock({
        status: 200,
        headers: makeHeaders({ 'content-type': 'text/html; charset=utf-8' }),
        bodyBytes: longBody.length,
        bodyHead: '<html><body>Listing details ...</body></html>',
      }),
    ).toBeNull();
  });
});

describe('condense', () => {
  it('extracts a JSON-LD <script> block', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'RealEstateListing',
      name: 'Modern Apartment in Legionowo',
      offers: { '@type': 'Offer', price: 850000, priceCurrency: 'PLN' },
    });
    const html = `
      <html lang="pl">
        <head>
          <title>Mieszkanie w Legionowie</title>
          <meta name="description" content="Świetne mieszkanie">
          <meta property="og:title" content="Mieszkanie w Legionowie">
          <script type="application/ld+json">${ld}</script>
        </head>
        <body><div>Body content</div></body>
      </html>
    `;
    const out = condense(html);

    expect(out).toContain('JSON_LD:');
    expect(out).toContain('"RealEstateListing"');
    expect(out).toContain('TITLE: Mieszkanie w Legionowie');
    expect(out).toContain('HTML_LANG: pl');
    expect(out).toContain('META_DESCRIPTION: Świetne mieszkanie');
    expect(out).toContain('og:title: Mieszkanie w Legionowie');
  });

  it('strips <script>, <style>, <svg>, <noscript> from BODY_TEXT', () => {
    const html = `
      <html><body>
        <script>const x = "should not appear";</script>
        <style>.foo { color: red; }</style>
        <svg><path d="should not appear" /></svg>
        <noscript>turn on js</noscript>
        <p>Visible paragraph copy</p>
      </body></html>
    `;
    const out = condense(html);
    expect(out).toContain('Visible paragraph copy');
    expect(out).not.toContain('should not appear');
    expect(out).not.toContain('color: red');
    expect(out).not.toContain('turn on js');
  });

  it('truncates the BODY_TEXT slice to ~60 KB', () => {
    // Build an 80 KB body of plain text — well above the 60 KB cap
    // but below the overall MAX_PROMPT_CHARS limit.
    const bigBody = 'lorem ipsum dolor sit amet '.repeat(4_000); // ~108 KB
    const html = `<html><body>${bigBody}</body></html>`;
    const out = condense(html);

    const bodyMarker = 'BODY_TEXT: ';
    const idx = out.indexOf(bodyMarker);
    expect(idx).toBeGreaterThan(-1);
    const bodyText = out.slice(idx + bodyMarker.length);
    expect(bodyText.length).toBeLessThanOrEqual(60_000);
    // Should still contain the front of the body.
    expect(bodyText).toContain('lorem ipsum');
  });

  it('caps the overall prompt at MAX_PROMPT_CHARS (~90 KB)', () => {
    // Build a body that, combined with multiple JSON-LD blocks, would
    // exceed 90 KB before truncation.
    const ld1 = '"x":"' + 'a'.repeat(20_000) + '"';
    const ld2 = '"y":"' + 'b'.repeat(20_000) + '"';
    const html = `
      <script type="application/ld+json">{${ld1}}</script>
      <script type="application/ld+json">{${ld2}}</script>
      <body>${'c'.repeat(70_000)}</body>
    `;
    const out = condense(html);
    expect(out.length).toBeLessThanOrEqual(90_000);
  });

  it('handles a page with no <title> / no JSON-LD without throwing', () => {
    const html = '<html><body><p>just some content</p></body></html>';
    const out = condense(html);
    expect(out).toContain('BODY_TEXT:');
    expect(out).toContain('just some content');
    expect(out).not.toContain('JSON_LD:');
  });
});

describe('fetchPage size cap', () => {
  it('rejects a 2 MB response body with "Source page too large" — never OOMs', async () => {
    // Build a chunked stream that emits 2 MB across a few chunks.
    const chunkSize = 256 * 1024; // 256 KB
    const totalBytes = 2 * 1024 * 1024; // 2 MB > MAX_FETCH_BYTES (1.5 MB)
    let emitted = 0;
    const filler = new Uint8Array(chunkSize).fill(120 /* 'x' */);

    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= totalBytes) {
          controller.close();
          return;
        }
        const remaining = totalBytes - emitted;
        const next = remaining >= chunkSize ? filler : filler.slice(0, remaining);
        emitted += next.byteLength;
        controller.enqueue(next);
      },
    });

    global.fetch = vi.fn(
      async () =>
        new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    ) as unknown as typeof fetch;

    await expect(fetchPage('https://example.com/big-listing')).rejects.toThrow(
      /too large/i,
    );
  });

  it('throws on non-2xx (e.g. 403) source responses', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('forbidden', {
          status: 403,
          headers: { 'content-type': 'text/html' },
        }),
    ) as unknown as typeof fetch;

    await expect(fetchPage('https://example.com/blocked')).rejects.toThrow(
      /HTTP 403/i,
    );
  });

  it('detects bot-block on otherwise OK responses with WAF headers', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response('a'.repeat(50_000), {
          status: 200,
          headers: {
            'content-type': 'text/html',
            'x-amzn-waf-action': 'challenge',
          },
        }),
    ) as unknown as typeof fetch;

    await expect(fetchPage('https://example.com/listing')).rejects.toThrow(
      /blocks scraping/i,
    );
  });
});
