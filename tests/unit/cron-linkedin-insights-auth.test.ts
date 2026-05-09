import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Auth-guard coverage for `GET /api/cron/linkedin-insights`.
 *
 * The route is exposed on the public internet (Cloudflare Pages); without
 * a hardened Bearer check anyone could DoS the writer or — worse — run
 * the cron repeatedly and hammer LinkedIn's rate limit. Tests below pin:
 *   - Missing CRON_SECRET in env → 503 (fail-closed)
 *   - No Authorization header → 401
 *   - Wrong Bearer → 401
 *   - Right Bearer + missing dependency env → 503 (still fails closed)
 *
 * We don't exercise the happy-path Supabase loop here — the writer-side
 * behaviour is asserted via the pure mapper test. The cron-route auth
 * guard MUST stay tight independent of writer correctness.
 */

const VALID_SECRET = 'a'.repeat(48);
const HEX_KEY = 'f'.repeat(64);

function setBaseEnv() {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://aho-web.pages.dev';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test-key';
}

function clearCronEnv() {
  delete process.env.CRON_SECRET;
  delete process.env.AHO_TOKEN_ENCRYPTION_KEY;
  delete process.env.LINKEDIN_API_VERSION;
}

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  // The route only reads `req.headers.get('authorization')`. A minimal
  // shim is enough; we don't need a full NextRequest instance.
  return {
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  setBaseEnv();
  clearCronEnv();
  vi.resetModules();
});

afterEach(() => {
  clearCronEnv();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('GET /api/cron/linkedin-insights — auth guard', () => {
  it('returns 503 cron_not_configured when CRON_SECRET is unset', async () => {
    const { GET } = await import('@/app/api/cron/linkedin-insights/route');
    const res = await GET(
      makeRequest({ authorization: `Bearer ${VALID_SECRET}` }),
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('cron_not_configured');
  });

  it('returns 401 unauthorized when Authorization header is absent', async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.AHO_TOKEN_ENCRYPTION_KEY = HEX_KEY;
    process.env.LINKEDIN_API_VERSION = '202504';
    const { GET } = await import('@/app/api/cron/linkedin-insights/route');
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 unauthorized when Bearer token does not match', async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.AHO_TOKEN_ENCRYPTION_KEY = HEX_KEY;
    process.env.LINKEDIN_API_VERSION = '202504';
    const { GET } = await import('@/app/api/cron/linkedin-insights/route');
    const res = await GET(
      makeRequest({ authorization: `Bearer ${'b'.repeat(48)}` }),
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('unauthorized');
  });

  it('returns 401 when Bearer prefix is missing (raw secret only)', async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.AHO_TOKEN_ENCRYPTION_KEY = HEX_KEY;
    process.env.LINKEDIN_API_VERSION = '202504';
    const { GET } = await import('@/app/api/cron/linkedin-insights/route');
    const res = await GET(makeRequest({ authorization: VALID_SECRET }));
    expect(res.status).toBe(401);
  });

  it('returns 503 token_encryption_key_missing when encryption key is unset (auth passes first)', async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.LINKEDIN_API_VERSION = '202504';
    delete process.env.AHO_TOKEN_ENCRYPTION_KEY;
    const { GET } = await import('@/app/api/cron/linkedin-insights/route');
    const res = await GET(
      makeRequest({ authorization: `Bearer ${VALID_SECRET}` }),
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('token_encryption_key_missing');
  });

  it('returns 503 linkedin_api_version_missing when version env is unset (auth passes first)', async () => {
    process.env.CRON_SECRET = VALID_SECRET;
    process.env.AHO_TOKEN_ENCRYPTION_KEY = HEX_KEY;
    delete process.env.LINKEDIN_API_VERSION;
    const { GET } = await import('@/app/api/cron/linkedin-insights/route');
    const res = await GET(
      makeRequest({ authorization: `Bearer ${VALID_SECRET}` }),
    );
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('linkedin_api_version_missing');
  });
});
