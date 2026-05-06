import 'server-only';
import { getOptionalRequestContext } from '@cloudflare/next-on-pages';

/**
 * KV-backed fixed-window rate limiter.
 *
 * Layered above the lead form's honeypot + Turnstile (`/api/leads`) so a
 * single attacker can't flood Brevo's outbound notifier even if they solve
 * the captcha once and replay the request shape. Hits per identifier are
 * counted per fixed window; we expire keys via KV TTL so there's no
 * sweeper to maintain.
 *
 * Identifier should be the Cloudflare-provided client IP (`cf-connecting-ip`,
 * with `x-forwarded-for` as a fallback for non-CF dev). When neither is
 * present we fall back to a single shared "unknown" bucket — tighter than
 * letting it through unbounded.
 *
 * Window semantics: a fixed-window counter (vs. sliding) trades a small
 * burst-at-window-boundary edge case for KV simplicity (one key, one
 * GET-then-PUT). For the lead-flood threat model that's acceptable; if we
 * ever need per-second precision we'll swap to a sliding-window or a
 * Durable Object.
 *
 * Degradation: when the KV binding isn't attached (local dev, tests, or
 * preview deploys without the namespace bound), this helper *allows* the
 * request and reports `skipped: true`. This is the same pattern as
 * `verifyTurnstileToken` — anti-abuse is best-effort in non-prod
 * environments rather than a deploy blocker.
 */

export interface RateLimitConfig {
  /** Stable bucket name — `leads`, `auth`, etc. Avoids cross-feature collisions. */
  namespace: string;
  /** Window length in seconds. Becomes the KV TTL. */
  windowSeconds: number;
  /** Max requests per identifier per window. */
  max: number;
}

export type RateLimitResult =
  | { allowed: true; remaining: number; skipped?: false }
  | { allowed: false; retryAfterSeconds: number; skipped?: false }
  | { allowed: true; skipped: true };

interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

function getKv(): KVNamespaceLike | null {
  const ctx = getOptionalRequestContext();
  if (!ctx) return null;
  const env = ctx.env as Record<string, unknown>;
  const kv = env.aho_rate_limit;
  if (!kv || typeof kv !== 'object') return null;
  return kv as KVNamespaceLike;
}

export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const kv = getKv();
  if (!kv) return { allowed: true, skipped: true };

  // Fixed window keyed by floor(now / window). When the window rolls over
  // the new key starts at zero. KV TTL cleans up the old key.
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % config.windowSeconds);
  const key = `rl:${config.namespace}:${identifier}:${windowStart}`;

  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) || 0 : 0;

  if (count >= config.max) {
    const retryAfterSeconds = config.windowSeconds - (now - windowStart);
    return { allowed: false, retryAfterSeconds };
  }

  // Fire-and-forget the increment write — we don't await it on the hot path.
  // KV's eventual consistency means a burst of concurrent requests can
  // momentarily under-count, but the next window resets and the
  // attacker still spends their token-of-trust on Turnstile each time.
  // Use the request's waitUntil if available so the write is guaranteed
  // to flush even if the response races ahead.
  const ctx = getOptionalRequestContext();
  const writePromise = kv.put(key, String(count + 1), {
    expirationTtl: Math.max(60, config.windowSeconds),
  });
  if (ctx?.ctx?.waitUntil) {
    ctx.ctx.waitUntil(writePromise);
  } else {
    // Best-effort — swallow rejections so a transient KV blip doesn't 500
    // the user-facing request.
    writePromise.catch(() => {});
  }

  return { allowed: true, remaining: Math.max(0, config.max - count - 1) };
}

export const LEAD_FORM_RATE_LIMIT: RateLimitConfig = {
  namespace: 'leads',
  windowSeconds: 3600,
  max: 10,
};
