/**
 * RLS tests for the auth_failure_log table + its SECURITY DEFINER RPCs.
 *
 * Pairs with `src/db/migrations/0039_auth_failure_log.sql`. Per
 * CLAUDE.md hard rule #2, every policy in that migration is exercised
 * here from the appropriate tier — positive (allowed) and negative
 * (denied).
 *
 * Two surfaces under test:
 *   1. Direct table access — must be DENIED for anon, registered, and
 *      agent. ALLOWED only for platform admins (read-only audit
 *      surface) and the service-role admin client (which bypasses RLS
 *      entirely and is what app code uses).
 *   2. SECURITY DEFINER RPCs (check_auth_lockout, record_auth_failure,
 *      prune_auth_failures) — must work from anon / authenticated
 *      contexts since the sign-in flow is by definition pre-auth.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, clientFor, ensureFixtures } from './_setup';

// One isolated email per test so concurrent runs (or future
// parallelization) don't see each other's rows.
const TEST_EMAIL = `aho-fixture-lockout-${Date.now()}@aho.test`;
const TEST_EMAIL_2 = `aho-fixture-lockout-2-${Date.now()}@aho.test`;
const TEST_EMAIL_PRUNE = `aho-fixture-lockout-prune-${Date.now()}@aho.test`;
const TEST_EMAIL_TIER2 = `aho-fixture-lockout-tier2-${Date.now()}@aho.test`;
const TEST_EMAIL_TIER3 = `aho-fixture-lockout-tier3-${Date.now()}@aho.test`;
const TEST_EMAIL_DIRECT = `aho-fixture-lockout-direct-${Date.now()}@aho.test`;

beforeAll(async () => {
  await ensureFixtures();
});

afterAll(async () => {
  // Clean up every fixture row this file produced.
  const a = admin();
  await a
    .from('auth_failure_log')
    .delete()
    .like('email', 'aho-fixture-lockout-%');
});

// ============================================================
// Direct table access — RLS denials for non-admins
// ============================================================

describe('RLS · auth_failure_log direct access', () => {
  it('anon cannot SELECT from auth_failure_log', async () => {
    const a = admin();
    // Seed a row so a missing-row return wouldn't be ambiguous.
    await a.rpc('record_auth_failure', {
      p_email: TEST_EMAIL_DIRECT,
      p_ip: '127.0.0.1',
      p_user_agent: 'rls-test',
    });
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('auth_failure_log')
      .select('id, email')
      .eq('email', TEST_EMAIL_DIRECT);
    // RLS rejects via empty result + no error. Either no rows or an
    // error indicates anon can't see the seeded row — both are fine
    // for the security guarantee.
    expect(error === null ? data?.length ?? 0 : 0).toBe(0);
  });

  it('a registered user cannot SELECT from auth_failure_log', async () => {
    const c = await clientFor('registered_a');
    const { data } = await c
      .from('auth_failure_log')
      .select('id')
      .eq('email', TEST_EMAIL_DIRECT);
    expect(data?.length ?? 0).toBe(0);
  });

  it('an agent cannot SELECT from auth_failure_log', async () => {
    const c = await clientFor('agent_a_owner');
    const { data } = await c
      .from('auth_failure_log')
      .select('id')
      .eq('email', TEST_EMAIL_DIRECT);
    expect(data?.length ?? 0).toBe(0);
  });

  it('a platform admin CAN SELECT from auth_failure_log', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('auth_failure_log')
      .select('id, email')
      .eq('email', TEST_EMAIL_DIRECT);
    expect(error).toBeNull();
    expect((data?.length ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('a registered user cannot INSERT directly into auth_failure_log', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('auth_failure_log')
      .insert({ email: 'forbidden@aho.test' });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// record_auth_failure RPC — anon + authenticated must work
// ============================================================

describe('RPC · record_auth_failure', () => {
  it('anon can call record_auth_failure (the sign-in form is pre-auth)', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c.rpc('record_auth_failure', {
      p_email: TEST_EMAIL,
      p_ip: '203.0.113.7',
      p_user_agent: 'rls-test/1.0',
    });
    expect(error).toBeNull();
    expect(data).toBeTypeOf('string'); // uuid

    // Verify the row landed via service-role.
    const a = admin();
    const { data: rows } = await a
      .from('auth_failure_log')
      .select('email, ip, user_agent')
      .eq('email', TEST_EMAIL);
    expect(rows?.length).toBe(1);
    expect(rows?.[0]?.email).toBe(TEST_EMAIL);
    expect(rows?.[0]?.ip).toBe('203.0.113.7');
  });

  it('record_auth_failure stores empty IP/UA as NULL', async () => {
    const c = await clientFor('anon');
    const { error } = await c.rpc('record_auth_failure', {
      p_email: TEST_EMAIL_2,
      p_ip: '',
      p_user_agent: '',
    });
    expect(error).toBeNull();
    const a = admin();
    const { data: rows } = await a
      .from('auth_failure_log')
      .select('ip, user_agent')
      .eq('email', TEST_EMAIL_2);
    expect(rows?.[0]?.ip).toBeNull();
    expect(rows?.[0]?.user_agent).toBeNull();
  });
});

// ============================================================
// check_auth_lockout RPC — threshold tiers
// ============================================================

describe('RPC · check_auth_lockout tiers', () => {
  async function seedFailures(email: string, n: number, minutesAgo = 0) {
    const a = admin();
    const baseAt = new Date(Date.now() - minutesAgo * 60_000);
    // Insert via direct table write (service-role bypasses RLS) so we
    // can control occurred_at precisely.
    const rows = Array.from({ length: n }, (_, i) => ({
      email,
      ip: '127.0.0.1',
      user_agent: 'tier-test',
      occurred_at: new Date(baseAt.getTime() + i).toISOString(),
    }));
    const { error } = await a.from('auth_failure_log').insert(rows);
    if (error) throw error;
  }

  // Type narrowing helper — supabase-js doesn't know the RPC is a
  // SETOF function without a generated Database type, so we cast at
  // call sites.
  type LockoutRow = {
    blocked: boolean;
    reason: string | null;
    retry_after: string | null;
    failure_count_10m: number;
    failure_count_30m: number;
    failure_count_60m: number;
  };

  it('a clean email is not blocked', async () => {
    const c = await clientFor('anon');
    const { data } = await c.rpc('check_auth_lockout', {
      p_email: `aho-fixture-lockout-clean-${Date.now()}@aho.test`,
    });
    const rows = (data ?? []) as unknown as LockoutRow[];
    expect(rows[0]?.blocked).toBe(false);
    expect(rows[0]?.failure_count_10m).toBe(0);
  });

  it('5 failures in 10 minutes triggers cooldown_1m', async () => {
    const email = `aho-fixture-lockout-tier1-${Date.now()}@aho.test`;
    await seedFailures(email, 5, 0);
    const c = await clientFor('anon');
    const { data } = await c.rpc('check_auth_lockout', { p_email: email });
    const rows = (data ?? []) as unknown as LockoutRow[];
    expect(rows[0]?.blocked).toBe(true);
    expect(rows[0]?.reason).toBe('cooldown_1m');
    expect(rows[0]?.retry_after).not.toBeNull();
  });

  it('10 failures in 30 minutes triggers cooldown_15m', async () => {
    // Distribute the failures across the 30m window: 4 within 10m,
    // and 6 more between 10m and 30m old.
    const a = admin();
    const baseAt = Date.now();
    const seedRows = [
      ...Array.from({ length: 4 }, (_, i) => ({
        email: TEST_EMAIL_TIER2,
        occurred_at: new Date(baseAt - 30_000 + i).toISOString(),
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        email: TEST_EMAIL_TIER2,
        occurred_at: new Date(baseAt - 15 * 60_000 + i).toISOString(),
      })),
    ];
    const { error } = await a.from('auth_failure_log').insert(seedRows);
    expect(error).toBeNull();

    const c = await clientFor('anon');
    const { data } = await c.rpc('check_auth_lockout', { p_email: TEST_EMAIL_TIER2 });
    const rpcRows = (data ?? []) as unknown as LockoutRow[];
    expect(rpcRows[0]?.blocked).toBe(true);
    expect(rpcRows[0]?.reason).toBe('cooldown_15m');
  });

  it('20 failures in 60 minutes triggers lockout_24h (most-severe wins)', async () => {
    // Spread the failures across the 60m window so the 30m and 10m
    // counters are both below their tier thresholds. We want only the
    // 60m bucket to fire.
    const a = admin();
    const baseAt = Date.now();
    const seedRows = Array.from({ length: 20 }, (_, i) => ({
      email: TEST_EMAIL_TIER3,
      // Spaced ~3 minutes apart over the last 59 minutes
      occurred_at: new Date(baseAt - (59 - i * 3) * 60_000).toISOString(),
    }));
    const { error } = await a.from('auth_failure_log').insert(seedRows);
    expect(error).toBeNull();

    const c = await clientFor('anon');
    const { data } = await c.rpc('check_auth_lockout', { p_email: TEST_EMAIL_TIER3 });
    const rpcRows = (data ?? []) as unknown as LockoutRow[];
    expect(rpcRows[0]?.blocked).toBe(true);
    expect(rpcRows[0]?.reason).toBe('lockout_24h');
  });
});

// ============================================================
// prune_auth_failures — anon DENIED, authenticated allowed
// ============================================================

describe('RPC · prune_auth_failures', () => {
  it('an authenticated user can prune their own failure log on success', async () => {
    const a = admin();
    // Seed 3 failures for the prune-target email.
    await a.from('auth_failure_log').insert([
      { email: TEST_EMAIL_PRUNE },
      { email: TEST_EMAIL_PRUNE },
      { email: TEST_EMAIL_PRUNE },
    ]);
    const c = await clientFor('registered_a');
    const { data, error } = await c.rpc('prune_auth_failures', {
      p_email: TEST_EMAIL_PRUNE,
    });
    expect(error).toBeNull();
    expect(data).toBeGreaterThanOrEqual(3);

    // Verify rows are gone via service-role.
    const { data: remaining } = await a
      .from('auth_failure_log')
      .select('id')
      .eq('email', TEST_EMAIL_PRUNE);
    expect(remaining?.length ?? 0).toBe(0);
  });

  it('anon cannot call prune_auth_failures (would let attackers wipe their trail)', async () => {
    const c = await clientFor('anon');
    const { error } = await c.rpc('prune_auth_failures', {
      p_email: 'someone@example.com',
    });
    expect(error).not.toBeNull();
  });
});
