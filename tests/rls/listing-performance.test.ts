/**
 * RLS tests for `listing_post_metrics` (migration 0037).
 *
 * Auth model recap:
 *   - SELECT  → org members read metrics for listings their org owns
 *               + admins read all
 *   - No INSERT/UPDATE/DELETE policies — service-role only via the
 *     future Meta Insights cron + FB Lead Ads webhook
 *   - Anon → no policy at all (denied by default)
 *
 * Today the table is empty in production; these tests seed via service-
 * role to exercise the RLS surface that the dashboard reads against.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  clientFor,
  ensureFixtures,
  type FixtureContext,
} from './_setup';

let ctx: FixtureContext;
const insertedIds: string[] = [];

beforeAll(async () => {
  ctx = await ensureFixtures();

  const a = admin();

  // Seed a Facebook snapshot on the org-A active listing.
  const ins1 = await a
    .from('listing_post_metrics')
    .insert({
      listing_id: ctx.orgAActiveListingId,
      platform: 'facebook',
      posted_at: new Date('2026-05-10T09:00:00Z').toISOString(),
      post_external_id: 'fb-fixture-post-1',
      reach: 250,
      impressions: 800,
      clicks: 18,
      leads: 2,
      cpl_cents: 600,
      currency: 'USD',
    })
    .select('id')
    .single();
  if (ins1.error || !ins1.data) {
    throw new Error(
      `listing_post_metrics seed failed: ${ins1.error?.message}`,
    );
  }
  insertedIds.push(ins1.data.id);

  // Plus an Instagram snapshot on the same listing (organic — no CPL).
  const ins2 = await a
    .from('listing_post_metrics')
    .insert({
      listing_id: ctx.orgAActiveListingId,
      platform: 'instagram',
      posted_at: new Date('2026-05-11T09:00:00Z').toISOString(),
      post_external_id: 'ig-fixture-post-1',
      reach: 95,
      impressions: 320,
      clicks: 4,
      leads: 0,
      cpl_cents: null,
      currency: 'USD',
    })
    .select('id')
    .single();
  if (ins2.error || !ins2.data) {
    throw new Error(
      `listing_post_metrics ig seed failed: ${ins2.error?.message}`,
    );
  }
  insertedIds.push(ins2.data.id);
});

afterAll(async () => {
  if (insertedIds.length > 0) {
    await admin().from('listing_post_metrics').delete().in('id', insertedIds);
  }
});

// ============================================================
// SELECT
// ============================================================

describe('RLS · listing_post_metrics · SELECT', () => {
  it('anon cannot read any metrics', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('listing_post_metrics')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A owner reads metrics for their own listing', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('listing_post_metrics')
      .select('id, platform, reach, leads')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });

  it('an org A non-owner agent ALSO reads metrics for their org', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('listing_post_metrics')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });

  it('an org B owner cannot see org A metrics (cross-org isolation)', async () => {
    const c = await clientFor('agent_b_owner');
    const { data, error } = await c
      .from('listing_post_metrics')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a registered user with no org membership cannot see any metrics', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('listing_post_metrics')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('admin reads any org’s metrics', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('listing_post_metrics')
      .select('id, listing_id, platform')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });
});

// ============================================================
// INSERT/UPDATE/DELETE — no user-context policies
// ============================================================

describe('RLS · listing_post_metrics · WRITE (no user-context policies)', () => {
  it('anon cannot insert', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('listing_post_metrics').insert({
      listing_id: ctx.orgAActiveListingId,
      platform: 'facebook',
      posted_at: new Date().toISOString(),
      post_external_id: 'anon-attempt',
      reach: 1,
    });
    expect(error).not.toBeNull();
  });

  it('an org owner cannot insert metrics directly (service-role only)', async () => {
    const c = await clientFor('agent_a_owner');
    const { error } = await c.from('listing_post_metrics').insert({
      listing_id: ctx.orgAActiveListingId,
      platform: 'facebook',
      posted_at: new Date().toISOString(),
      post_external_id: 'owner-attempt',
      reach: 1,
    });
    expect(error).not.toBeNull();
  });

  it('an org owner cannot update their own metric rows (service-role only)', async () => {
    if (insertedIds.length === 0) return;
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('listing_post_metrics')
      .update({ reach: 999_999 })
      .eq('id', insertedIds[0])
      .select('id');
    // Either error is non-null OR the update silently affected zero rows.
    // RLS without an UPDATE policy returns zero rows + no error in
    // PostgREST.
    if (!error) {
      expect(data ?? []).toHaveLength(0);
      const check = await admin()
        .from('listing_post_metrics')
        .select('reach')
        .eq('id', insertedIds[0])
        .single();
      // Confirm the actual row was NOT updated.
      expect(check.data?.reach).not.toBe(999_999);
    }
  });

  it('an org owner cannot delete their own metric rows (service-role only)', async () => {
    if (insertedIds.length === 0) return;
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('listing_post_metrics')
      .delete()
      .eq('id', insertedIds[0]);
    if (!error) {
      const check = await admin()
        .from('listing_post_metrics')
        .select('id')
        .eq('id', insertedIds[0]);
      expect((check.data ?? []).length).toBe(1);
    }
  });
});
