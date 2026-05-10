import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Regression test for QA-2026-05-10 P0 #3.
 *
 * GET (and POST) /api/properties/:id/import-photos/failures used to pass
 * the raw `:id` param straight into PostgREST's `.eq('property_id', id)`.
 * If the value isn't a uuid Postgres raises 22P02 and the route surfaced
 * a 500 instead of a clean 400. The fix uses `z.string().uuid()` to
 * validate up front (matching the sibling /favorite/route.ts).
 */

beforeEach(() => {
  // The route imports a Supabase client builder; the uuid guard
  // short-circuits before any client is created. Provide minimum env so
  // the import doesn't throw.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test-key';
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

function makeRequest(): NextRequest {
  return {
    json: async () => ({}),
  } as unknown as NextRequest;
}

describe('GET /api/properties/:id/import-photos/failures — uuid validation', () => {
  it('returns 400 invalid_id when :id is not a uuid', async () => {
    const { GET } = await import(
      '@/app/api/properties/[id]/import-photos/failures/route'
    );
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('invalid_id');
  });

  it('returns 400 invalid_id when :id is the empty string', async () => {
    const { GET } = await import(
      '@/app/api/properties/[id]/import-photos/failures/route'
    );
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 invalid_id when :id is structurally close but not a real uuid', async () => {
    const { GET } = await import(
      '@/app/api/properties/[id]/import-photos/failures/route'
    );
    // Right shape (5 dash-separated groups) but invalid hex letters.
    const res = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/properties/:id/import-photos/failures — uuid validation', () => {
  it('returns 400 invalid_id when :id is not a uuid', async () => {
    const { POST } = await import(
      '@/app/api/properties/[id]/import-photos/failures/route'
    );
    const res = await POST(makeRequest(), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('invalid_id');
  });
});
