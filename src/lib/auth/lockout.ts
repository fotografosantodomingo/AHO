/**
 * Progressive lockout for password sign-in attempts.
 *
 * Two pieces:
 *   1. A pure `evaluateLockout(counts, lastFailureAt, now)` function that
 *      maps failure counts to a lockout decision. Pure ⇒ unit-testable
 *      without any DB. The thresholds are duplicated in
 *      `src/db/migrations/0039_auth_failure_log.sql` (function
 *      `check_auth_lockout`); both must move together.
 *   2. A thin wrapper `checkLockout(email)` / `recordAuthFailure(...)` /
 *      `pruneAuthFailures(email)` that hits the SECURITY DEFINER RPCs
 *      defined by the migration.
 *
 * Why a separate email-keyed layer (vs the existing IP-keyed
 * Cloudflare KV rate-limit on /api/leads etc.): an attacker rotating
 * IPs through a residential proxy pool defeats IP-only limits but
 * still has to commit a password attempt against ONE email — which
 * this layer caps. The two layers are complementary, not redundant.
 */

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

// =============================================================
// Pure threshold logic — DB-free, edge-safe, unit-testable.
// =============================================================

/** Failure counts within rolling windows. */
export interface LockoutCounts {
  /** Failures in the last 10 minutes. */
  count10m: number;
  /** Failures in the last 30 minutes. */
  count30m: number;
  /** Failures in the last 60 minutes. */
  count60m: number;
}

export type LockoutReason = 'cooldown_1m' | 'cooldown_15m' | 'lockout_24h';

export interface LockoutDecision {
  blocked: boolean;
  /** Stable machine code; UI translates via `auth.lockout.<reason>`. */
  reason?: LockoutReason;
  /** When the user may retry. UI renders relative time from `now`. */
  retryAfter?: Date;
  /** Echo of the counts for diagnostics / logging. */
  counts: LockoutCounts;
}

/**
 * Threshold table — single source of truth for the TS layer. The
 * SQL function `check_auth_lockout` mirrors these in DB; tests
 * assert that the TS evaluator and the SQL function agree on the
 * same inputs.
 *
 * Order matters: more-severe tiers come first so a row that meets
 * "20 in 60m" is reported as `lockout_24h` even though it also
 * trivially satisfies the lower tiers.
 */
export const LOCKOUT_TIERS = [
  {
    /** 20+ failures in 60 min → 24-hour lockout. Manual unlock required. */
    reason: 'lockout_24h' as const,
    threshold: 20,
    windowMinutes: 60,
    cooldownMs: 24 * 60 * 60 * 1000,
  },
  {
    /** 10+ failures in 30 min → 15-minute cooldown. */
    reason: 'cooldown_15m' as const,
    threshold: 10,
    windowMinutes: 30,
    cooldownMs: 15 * 60 * 1000,
  },
  {
    /** 5+ failures in 10 min → 1-minute cooldown. */
    reason: 'cooldown_1m' as const,
    threshold: 5,
    windowMinutes: 10,
    cooldownMs: 60 * 1000,
  },
] as const;

/**
 * Evaluate a lockout decision from already-counted failures.
 *
 * @param counts  Failure counts in the rolling 10/30/60-minute windows.
 * @param lastFailureAt  Timestamp of the most recent failure within
 *   the longest window (60 min). `null` means no failures at all.
 * @param now  Reference "now" for cooldown math. Caller passes
 *   `new Date()` in production; tests pass a fixed instant.
 */
export function evaluateLockout(
  counts: LockoutCounts,
  lastFailureAt: Date | null,
  now: Date,
): LockoutDecision {
  for (const tier of LOCKOUT_TIERS) {
    const count =
      tier.windowMinutes === 10
        ? counts.count10m
        : tier.windowMinutes === 30
          ? counts.count30m
          : counts.count60m;
    if (count >= tier.threshold) {
      const base = lastFailureAt ?? now;
      return {
        blocked: true,
        reason: tier.reason,
        retryAfter: new Date(base.getTime() + tier.cooldownMs),
        counts,
      };
    }
  }
  return { blocked: false, counts };
}

// =============================================================
// DB-backed wrappers — call the SECURITY DEFINER RPCs.
// =============================================================

interface CheckAuthLockoutRow {
  blocked: boolean;
  reason: string | null;
  retry_after: string | null;
  failure_count_10m: number;
  failure_count_30m: number;
  failure_count_60m: number;
}

/**
 * Query the current lockout state for an email. Uses the service-role
 * admin client because (a) the RPC is allowed for anon/authenticated
 * but service-role gives us a stable code path regardless of caller
 * context, and (b) lockout reads happen pre-auth, so the request has
 * no user session yet.
 */
export async function checkLockout(email: string): Promise<LockoutDecision> {
  const a = createAdminClient();
  const { data, error } = await a.rpc('check_auth_lockout', { p_email: email });
  if (error) {
    // Fail open on RPC errors — better to allow the sign-in attempt
    // (which Supabase rate-limits independently) than to surface a
    // confusing "we don't know your lockout state" 500. Logged
    // server-side so we notice if this regresses.
    console.error('checkLockout RPC failed', error);
    return {
      blocked: false,
      counts: { count10m: 0, count30m: 0, count60m: 0 },
    };
  }
  // The RPC returns a SETOF row (TABLE-shaped). The supabase-js types
  // don't know that without a generated `Database` type, so we
  // narrow at runtime.
  const rows = (data ?? []) as unknown as CheckAuthLockoutRow[];
  const row = rows[0];
  if (!row) {
    return {
      blocked: false,
      counts: { count10m: 0, count30m: 0, count60m: 0 },
    };
  }
  const reason = isLockoutReason(row.reason) ? row.reason : undefined;
  return {
    blocked: row.blocked,
    reason,
    retryAfter: row.retry_after ? new Date(row.retry_after) : undefined,
    counts: {
      count10m: row.failure_count_10m,
      count30m: row.failure_count_30m,
      count60m: row.failure_count_60m,
    },
  };
}

function isLockoutReason(value: string | null): value is LockoutReason {
  return value === 'cooldown_1m' || value === 'cooldown_15m' || value === 'lockout_24h';
}

export interface RecordAuthFailureInput {
  email: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Record one failed sign-in attempt. Called both on actual auth
 * rejection AND when the request is short-circuited by an active
 * lockout — so a determined attacker can't reset the clock by
 * pounding on a locked-out account.
 */
export async function recordAuthFailure(input: RecordAuthFailureInput): Promise<void> {
  const a = createAdminClient();
  const { error } = await a.rpc('record_auth_failure', {
    p_email: input.email,
    p_ip: input.ip ?? null,
    p_user_agent: input.userAgent ?? null,
  });
  if (error) {
    // Don't fail the user-facing call on a logging failure. Log
    // server-side and move on — the worst case is we mis-count by
    // one, not that we let a bad actor in.
    console.error('recordAuthFailure RPC failed', error);
  }
}

/**
 * Wipe the user's failure history after a successful sign-in. Without
 * this, a user who finally got their password right would carry
 * stale failures forward; one slip later and they'd hit the cooldown
 * for the wrong reason.
 */
export async function pruneAuthFailures(email: string): Promise<void> {
  const a = createAdminClient();
  const { error } = await a.rpc('prune_auth_failures', { p_email: email });
  if (error) {
    console.error('pruneAuthFailures RPC failed', error);
  }
}
