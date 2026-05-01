/**
 * Email-verification token generation for the reviews flow.
 *
 * 32-char lowercase hex from 16 random bytes via Web Crypto. Edge-runtime
 * compatible (no Node.js `crypto` module). Output charset matches the
 * SQL-side check `char_length(p_token) = 32` in
 * `verify_review_token(p_token)`.
 *
 * 16 bytes = 128 bits of entropy. Collision probability for 1M tokens
 * outstanding is ~1.5e-27 — vanishingly small. Brute-forcing would need
 * 2^128 attempts.
 *
 * TTL applied at the DB layer (`verification_token_expires_at`); this
 * helper just returns the token string + the expiry timestamp the route
 * should write.
 */

const TOKEN_BYTES = 16; // → 32 hex chars
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface VerificationTokenPair {
  token: string;
  expiresAt: string; // ISO-8601 UTC
}

export function generateVerificationToken(): VerificationTokenPair {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  return { token, expiresAt };
}

export const REVIEW_TOKEN_LENGTH = TOKEN_BYTES * 2;
export const REVIEW_TOKEN_TTL_MS = TOKEN_TTL_MS;
