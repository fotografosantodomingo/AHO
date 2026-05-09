import { describe, expect, it } from 'vitest';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';

/**
 * Auth-guard unit tests for /api/cron/meta-insights.
 *
 * The pure `checkCronAuth` function is exported from the route module
 * specifically so this guard can be exercised without a Next request.
 * Behaviour tested:
 *   - Missing/blank authorization → 401
 *   - Wrong scheme → 401
 *   - Right scheme + wrong secret → 401
 *   - Right scheme + right secret → ok
 *   - Server-side secret missing → 503 (so the scheduler retries)
 *   - Constant-time comparison: equal-length wrong secret still rejects
 */

const SECRET = 'super-secret-bearer-with-min-length-1234';

describe('checkCronAuth', () => {
  it('accepts a Bearer token that matches the configured secret exactly', () => {
    const r = checkCronAuth({
      authorizationHeader: `Bearer ${SECRET}`,
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects a missing authorization header', () => {
    const r = checkCronAuth({
      authorizationHeader: null,
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.errorCode).toBe('missing_bearer');
    }
  });

  it('rejects an empty authorization header', () => {
    const r = checkCronAuth({
      authorizationHeader: '',
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('rejects a non-Bearer scheme', () => {
    for (const bad of [SECRET, `Basic ${SECRET}`, `Token ${SECRET}`]) {
      const r = checkCronAuth({
        authorizationHeader: bad,
        expectedSecret: SECRET,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errorCode).toBe('missing_bearer');
    }
  });

  it('rejects a wrong secret of equal length', () => {
    // Same length as SECRET — exercises the constant-time path inside
    // the loop instead of bailing early on the length mismatch.
    const wrong = SECRET.replace('super', 'WRONG');
    expect(wrong.length).toBe(SECRET.length);
    const r = checkCronAuth({
      authorizationHeader: `Bearer ${wrong}`,
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.errorCode).toBe('bad_bearer');
    }
  });

  it('rejects a wrong secret of unequal length', () => {
    const r = checkCronAuth({
      authorizationHeader: `Bearer ${SECRET}-extra`,
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('bad_bearer');
  });

  it('handles a mixed-case Bearer prefix', () => {
    const r = checkCronAuth({
      authorizationHeader: `bearer ${SECRET}`,
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(true);
  });

  it('returns 503 when the server-side secret is unset', () => {
    const r = checkCronAuth({
      authorizationHeader: `Bearer ${SECRET}`,
      expectedSecret: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(503);
      expect(r.errorCode).toBe('cron_secret_unconfigured');
    }
  });

  it('returns 503 when the server-side secret is empty (treated as unset)', () => {
    const r = checkCronAuth({
      authorizationHeader: `Bearer ${SECRET}`,
      expectedSecret: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it('tolerates trailing whitespace in the header', () => {
    const r = checkCronAuth({
      authorizationHeader: `   Bearer ${SECRET}   `,
      expectedSecret: SECRET,
    });
    expect(r.ok).toBe(true);
  });
});
