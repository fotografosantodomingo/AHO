/**
 * RLS tests for `property_recent_views` (migration 0025).
 *
 * Auth model recap:
 *   - SELECT  → owner (user_id = auth.uid()) + admin
 *   - DELETE  → owner + admin
 *   - INSERT/UPDATE → no policies (server-mediated only via service-role)
 *   - Anon → no policy at all (denied by default; reads happen via
 *            service-role server-side using the aho_anon_id cookie)
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

  // Pre-seed via admin: registered_a viewed the active org-A listing.
  const a = admin();
  await a
    .from('property_recent_views')
    .delete()
    .in('user_id', [userIdRegA, userIdRegB]);
  const ins = await a.from('property_recent_views').insert({
    user_id: userIdRegA,
    anonymous_id: null,
    property_id: ctx.orgAActiveListingId,
    locale: 'en',
    source_path: '/en/search',
  });
  if (ins.error) throw new Error(`recent-views seed failed: ${ins.error.message}`);
});

afterAll(async () => {
  await admin()
    .from('property_recent_views')
    .delete()
    .in('user_id', [userIdRegA, userIdRegB]);
});

// ============================================================
// SELECT
// ============================================================

describe('RLS · property_recent_views · SELECT', () => {
  it('anon cannot read any recent views', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('property_recent_views')
      .select('id')
      .eq('user_id', userIdRegA);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('owner reads own recent view rows', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('property_recent_views')
      .select('id, property_id')
      .eq('user_id', userIdRegA);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it('a different user cannot see another user’s views', async () => {
    const c = await clientFor('registered_b');
    const { data, error } = await c
      .from('property_recent_views')
      .select('id')
      .eq('user_id', userIdRegA);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('admin sees any user’s views', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('property_recent_views')
      .select('id, user_id')
      .eq('user_id', userIdRegA);
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

// ============================================================
// INSERT (no user-context policy — service-role only)
// ============================================================

describe('RLS · property_recent_views · INSERT', () => {
  it('anon cannot insert', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('property_recent_views').insert({
      anonymous_id: '00000000-0000-0000-0000-000000000001',
      property_id: ctx.orgAActiveListingId,
      locale: 'en',
    });
    expect(error).not.toBeNull();
  });

  it('authenticated user CANNOT insert directly (no INSERT policy)', async () => {
    // Server-mediated only — even with their own user_id, the policy is
    // absent so the write is denied.
    const c = await clientFor('registered_b');
    const { error } = await c.from('property_recent_views').insert({
      user_id: userIdRegB,
      property_id: ctx.orgAActiveListingId,
      locale: 'en',
    });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// DELETE
// ============================================================

describe('RLS · property_recent_views · DELETE', () => {
  it('owner can delete own row', async () => {
    // Pre-seed a fresh row to delete (the upper-scope row stays for
    // SELECT tests above; this one is just for this test).
    const seed = await admin()
      .from('property_recent_views')
      .insert({
        user_id: userIdRegA,
        property_id: ctx.orgADraftListingId, // any property is fine for the row
        locale: 'en',
      })
      .select('id')
      .single();
    expect(seed.error).toBeNull();
    if (!seed.data) return;

    const c = await clientFor('registered_a');
    const { error } = await c
      .from('property_recent_views')
      .delete()
      .eq('id', seed.data.id);
    expect(error).toBeNull();
  });

  it('a different user cannot delete another user’s row (silent zero-row)', async () => {
    // Insert via the SECURITY DEFINER RPC so the partial-unique works,
    // then fetch the row id back. Using a different property than the
    // beforeAll seed to avoid the collision.
    const rpc = await admin().rpc('record_property_view', {
      p_user_id: userIdRegA,
      p_anonymous_id: null,
      p_property_id: ctx.orgADraftListingId,
      p_locale: 'en',
      p_source_path: null,
    });
    expect(rpc.error).toBeNull();
    const seed = await admin()
      .from('property_recent_views')
      .select('id')
      .eq('user_id', userIdRegA)
      .eq('property_id', ctx.orgADraftListingId)
      .single();
    expect(seed.error).toBeNull();
    if (!seed.data) return;

    const c = await clientFor('registered_b');
    const { error } = await c
      .from('property_recent_views')
      .delete()
      .eq('id', seed.data.id);
    if (!error) {
      const check = await admin()
        .from('property_recent_views')
        .select('id')
        .eq('id', seed.data.id);
      expect((check.data ?? []).length).toBe(1);
    }

    // Don't delete here — the row matches the long-lived seed row from
    // beforeAll, and the afterAll() block scoops up everything by user_id.
  });
});
