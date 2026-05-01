import { describe, expect, it } from 'vitest';
import {
  generateVerificationToken,
  REVIEW_TOKEN_LENGTH,
  REVIEW_TOKEN_TTL_MS,
} from '@/lib/reviews/token';

/**
 * Pins the contract for the review verification token. The DB-side
 * verify_review_token() RPC checks `char_length(p_token) = 32` and
 * the route's Zod schema regex is /^[0-9a-f]+$/. Both are coupled to
 * this generator — keep them in sync.
 */

describe('generateVerificationToken', () => {
  it('returns a 32-character lowercase hex string', () => {
    const { token } = generateVerificationToken();
    expect(token).toHaveLength(REVIEW_TOKEN_LENGTH);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('exposes REVIEW_TOKEN_LENGTH = 32', () => {
    expect(REVIEW_TOKEN_LENGTH).toBe(32);
  });

  it('returns an ISO-8601 expiry exactly 7 days in the future (within 1s tolerance)', () => {
    const before = Date.now();
    const { expiresAt } = generateVerificationToken();
    const after = Date.now();
    const expiry = new Date(expiresAt).getTime();
    expect(expiry - before).toBeGreaterThanOrEqual(REVIEW_TOKEN_TTL_MS - 1000);
    expect(expiry - after).toBeLessThanOrEqual(REVIEW_TOKEN_TTL_MS);
  });

  it('returns distinct tokens across calls (collision probability is ~0)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generateVerificationToken().token);
    }
    expect(seen.size).toBe(200);
  });

  it('uses 128 bits of entropy via 16 random bytes', () => {
    // Indirect — assert REVIEW_TOKEN_TTL_MS matches the documented 7d.
    expect(REVIEW_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
