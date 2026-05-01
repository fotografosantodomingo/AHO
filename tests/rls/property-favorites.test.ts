/**
 * RLS tests for the `property_favorites` table (migration 0024).
 *
 * Auth model recap:
 *   - SELECT  → owner (user_id = auth.uid()) + admins via separate policy
 *   - INSERT  → owner only (with check user_id = auth.uid())
 *   - DELETE  → owner + admins
 *   - No UPDATE policy (favorites are toggle-only)
 *   - Anon → no policy at all (denied by default)
 *
 * Per CLAUDE.md hard rule #2 every RLS policy ships with a paired test
 * exercising it from each affected tier — positive + negative.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  clientFor,
  ensureFixtures,
  fixtureUserId,
  type FixtureContext,
} from './_setup';

let ctx: FixtureContext;
let userIdRegA: string;
let userIdRegB: string;

beforeAll(async () => {
  ctx = await ensureFixtures();
  userIdRegA = await fixtureUserId('registered_a');
  userIdRegB = await fixtureUserId('registered_b');

  // Pre-seed: registered_a has the active org-A listing favorited.
  // registered_b has nothing favorited yet.
  const a = admin();
  await a.from('property_favorites').delete().in('user_id', [userIdRegA, userIdRegB]);
  const ins = await a.from('property_favorites').insert({
    user_id: userIdRegA,
    property_id: ctx.orgAActiveListingId,
  });
  if (ins.error) throw new Error(`favorites seed failed: ${ins.error.message}`);
});

afterAll(async () => {
  await admin()
    .from('property_favorites')
    .delete()
    .in('user_id', [userIdRegA, userIdRegB]);
});

// ============================================================
// SELECT
// ============================================================

describe('RLS · property_favorites · SELECT', () => {
  it('anon cannot read any favorites', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('property_favorites')
      .select('user_id, property_id')
      .eq('property_id', ctx.orgAActiveListingId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('owner reads own favorite row', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('property_favorites')
      .select('user_id, property_id')
      .eq('property_id', ctx.orgAActiveListingId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.user_id).toBe(userIdRegA);
  });

  it('a different user cannot see another user’s favorites', async () => {
    const c = await clientFor('registered_b');
    const { data, error } = await c
      .from('property_favorites')
      .select('user_id, property_id')
      .eq('user_id', userIdRegA);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('admin reads any user’s favorites', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('property_favorites')
      .select('user_id, property_id')
      .eq('user_id', userIdRegA);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

// ============================================================
// INSERT
// ============================================================

describe('RLS · property_favorites · INSERT', () => {
  it('anon cannot insert', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('property_favorites').insert({
      user_id: userIdRegA,
      property_id: ctx.orgAActiveListingId,
    });
    expect(error).not.toBeNull();
  });

  it('owner can insert with own user_id', async () => {
    const c = await clientFor('registered_b');
    const { error } = await c.from('property_favorites').insert({
      user_id: userIdRegB,
      property_id: ctx.orgAActiveListingId,
    });
    expect(error).toBeNull();
    // Cleanup so other tests have a known starting state.
    await admin()
      .from('property_favorites')
      .delete()
      .eq('user_id', userIdRegB)
      .eq('property_id', ctx.orgAActiveListingId);
  });

  it('user CANNOT insert with someone else’s user_id', async () => {
    const c = await clientFor('registered_b');
    const { error } = await c.from('property_favorites').insert({
      user_id: userIdRegA, // not auth.uid() — must be denied
      property_id: ctx.orgAActiveListingId,
    });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// DELETE
// ============================================================

describe('RLS · property_favorites · DELETE', () => {
  it('owner can delete own favorite', async () => {
    // Re-insert the row first so this test is independent of order.
    await admin().from('property_favorites').upsert({
      user_id: userIdRegA,
      property_id: ctx.orgAActiveListingId,
    });
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('property_favorites')
      .delete()
      .eq('user_id', userIdRegA)
      .eq('property_id', ctx.orgAActiveListingId);
    expect(error).toBeNull();

    const check = await admin()
      .from('property_favorites')
      .select('user_id')
      .eq('user_id', userIdRegA)
      .eq('property_id', ctx.orgAActiveListingId);
    expect((check.data ?? []).length).toBe(0);

    // Restore for downstream tests.
    await admin().from('property_favorites').insert({
      user_id: userIdRegA,
      property_id: ctx.orgAActiveListingId,
    });
  });

  it('a different user CANNOT delete another user’s favorite (silent zero-row)', async () => {
    const c = await clientFor('registered_b');
    const { error } = await c
      .from('property_favorites')
      .delete()
      .eq('user_id', userIdRegA)
      .eq('property_id', ctx.orgAActiveListingId);
    // Either errors or returns 0 affected (silent RLS no-op). Either is fine.
    if (!error) {
      const check = await admin()
        .from('property_favorites')
        .select('user_id')
        .eq('user_id', userIdRegA)
        .eq('property_id', ctx.orgAActiveListingId);
      expect((check.data ?? []).length).toBe(1);
    }
  });

  it('admin can delete any favorite', async () => {
    await admin().from('property_favorites').upsert({
      user_id: userIdRegA,
      property_id: ctx.orgAActiveListingId,
    });
    const c = await clientFor('admin');
    const { error } = await c
      .from('property_favorites')
      .delete()
      .eq('user_id', userIdRegA)
      .eq('property_id', ctx.orgAActiveListingId);
    expect(error).toBeNull();
  });
});
