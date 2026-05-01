/**
 * Have I Been Pwned (Pwned Passwords) k-anonymity check.
 *
 * Sends only the FIRST 5 characters of the SHA-1 hash to HIBP. The remote
 * server returns a list of hash suffixes for all leaked passwords sharing
 * that prefix. We compare locally — the password itself never leaves the
 * client, and HIBP doesn't see enough to identify the password.
 *
 * Defense-in-depth, not a gate. If HIBP is unreachable (network blip, rate
 * limit, downtime) we treat the password as not-pwned and let signup
 * proceed. The Supabase password policy + our zod rules are the primary
 * enforcement.
 *
 * Spec ref: PO security checklist 2026-04-30.
 */

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';

async function sha1Hex(input: string): Promise<string> {
  // Web Crypto API — works in Edge runtime, modern browsers, and Node 20+.
  const buffer = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export interface PwnedCheckResult {
  /** True if this exact password appears in known breach data. */
  pwned: boolean;
  /** How many times the password has appeared in breaches (0 when unknown). */
  count: number;
  /** Set when the call failed and we fell back to "not pwned". */
  errored?: boolean;
}

/**
 * Check whether a candidate password appears in HIBP's leak corpus.
 * Returns `{ pwned: false }` on any network / parse error (fail-open).
 */
export async function isPasswordPwned(
  password: string,
  signal?: AbortSignal,
): Promise<PwnedCheckResult> {
  try {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const res = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      headers: {
        // Per HIBP API v3 docs — we don't request padding to reduce payload.
        // Padding is only useful when shielding count from server-side
        // observers; we don't need it.
        accept: 'text/plain',
      },
      signal,
    });
    if (!res.ok) return { pwned: false, count: 0, errored: true };
    const body = await res.text();

    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const [hashSuffix, countStr] = line.split(':');
      if (hashSuffix === suffix) {
        const count = Number.parseInt(countStr ?? '0', 10);
        return { pwned: true, count: Number.isFinite(count) ? count : 0 };
      }
    }
    return { pwned: false, count: 0 };
  } catch {
    return { pwned: false, count: 0, errored: true };
  }
}
