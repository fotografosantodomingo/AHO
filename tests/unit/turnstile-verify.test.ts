import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verifyTurnstileToken } from '@/lib/auth/turnstile-verify';

/**
 * Server-side Turnstile siteverify wrapper. Pure-fetch + JSON parse.
 * Test paths:
 *   - secret unset → skipped (local dev)
 *   - missing token → invalid with 'missing_token'
 *   - siteverify success → valid
 *   - siteverify failure → invalid with first error code
 *   - siteverify network error → invalid with 'siteverify_unreachable' (fail-closed)
 */

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SECRET = process.env.TURNSTILE_SECRET_KEY;

beforeEach(() => {
  process.env.TURNSTILE_SECRET_KEY = 'test-secret-value';
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.TURNSTILE_SECRET_KEY;
  } else {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_SECRET;
  }
});

describe('verifyTurnstileToken', () => {
  it('skips when TURNSTILE_SECRET_KEY is unset (local dev / preview)', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const result = await verifyTurnstileToken('any-token');
    expect(result).toEqual({ skipped: true });
  });

  it('returns missing_token when token is null', async () => {
    const result = await verifyTurnstileToken(null);
    expect(result).toEqual({ valid: false, error: 'missing_token' });
  });

  it('returns missing_token when token is empty string', async () => {
    const result = await verifyTurnstileToken('');
    expect(result).toEqual({ valid: false, error: 'missing_token' });
  });

  it('returns valid:true on Cloudflare success response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const result = await verifyTurnstileToken('legit-token');
    expect(result).toEqual({ valid: true });
  });

  it('returns the first error code when Cloudflare rejects the token', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
        }),
        { status: 200 },
      ),
    );
    const result = await verifyTurnstileToken('reused-token');
    expect(result).toEqual({ valid: false, error: 'invalid-input-response' });
  });

  it('falls back to http_<status> when no error-codes are returned', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), { status: 503 }),
    );
    const result = await verifyTurnstileToken('any-token');
    expect(result).toEqual({ valid: false, error: 'http_503' });
  });

  it('fails closed on network error (siteverify_unreachable)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await verifyTurnstileToken('any-token');
    expect(result).toEqual({ valid: false, error: 'siteverify_unreachable' });
  });

  it('passes the remoteip when supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    globalThis.fetch = fetchMock;
    await verifyTurnstileToken('token', '203.0.113.45');
    const call = fetchMock.mock.calls[0];
    const body = call?.[1]?.body as URLSearchParams;
    expect(body.get('remoteip')).toBe('203.0.113.45');
    expect(body.get('secret')).toBe('test-secret-value');
    expect(body.get('response')).toBe('token');
  });
});
