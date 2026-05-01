/**
 * RLS tests for `property_events` (migration 0027).
 *
 * Auth model recap:
 *   - SELECT  → org members read events for their own org's properties
 *               + admins read all
 *   - No INSERT/UPDATE/DELETE policies — service-role only via API routes
 *   - Anon → no policy at all (denied by default; analytics is org-scoped)
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
const insertedIds: string[] = [];

beforeAll(async () => {
  ctx = await ensureFixtures();

  // Pre-seed: a property_view event on the org-A active listing.
  const a = admin();
  const userIdRegA = await fixtureUserId('registered_a');
  const ins = await a
    .from('property_events')
    .insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      user_id: userIdRegA,
      anonymous_id: null,
      event_type: 'property_view',
      source: 'search',
      metadata: { source_path: '/en/search' },
    })
    .select('id')
    .single();
  if (ins.error || !ins.data) {
    throw new Error(`property_events seed failed: ${ins.error?.message}`);
  }
  insertedIds.push(ins.data.id);

  // Plus a lead_form_submit event from anon (no user_id).
  const ins2 = await a
    .from('property_events')
    .insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      user_id: null,
      anonymous_id: '00000000-0000-0000-0000-000000000099',
      event_type: 'lead_form_submit',
      source: 'form',
      metadata: { has_message: true },
    })
    .select('id')
    .single();
  if (ins2.error || !ins2.data) {
    throw new Error(`property_events anon seed failed: ${ins2.error?.message}`);
  }
  insertedIds.push(ins2.data.id);
});

afterAll(async () => {
  if (insertedIds.length > 0) {
    await admin().from('property_events').delete().in('id', insertedIds);
  }
});

// ============================================================
// SELECT
// ============================================================

describe('RLS · property_events · SELECT', () => {
  it('anon cannot read any events', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('property_events')
      .select('id')
      .eq('org_id', ctx.orgAId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A member reads events for their org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('property_events')
      .select('id, event_type, source')
      .eq('org_id', ctx.orgAId)
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });

  it('an org A non-owner agent ALSO reads events for their org', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('property_events')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });

  it('an org B owner cannot see org A events (cross-org isolation)', async () => {
    const c = await clientFor('agent_b_owner');
    const { data, error } = await c
      .from('property_events')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a registered user with no org membership cannot see any events', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('property_events')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('admin reads any org’s events', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('property_events')
      .select('id, org_id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });
});

// ============================================================
// INSERT/UPDATE/DELETE — no user-context policies
// ============================================================

describe('RLS · property_events · WRITE (no user-context policies)', () => {
  it('anon cannot insert', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('property_events').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      event_type: 'property_view',
      source: 'home',
    });
    expect(error).not.toBeNull();
  });

  it('an org owner cannot insert events directly (server-mediated only)', async () => {
    const c = await clientFor('agent_a_owner');
    const { error } = await c.from('property_events').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      event_type: 'property_view',
      source: 'home',
    });
    expect(error).not.toBeNull();
  });

  it('an org owner cannot delete their own org’s events (append-only)', async () => {
    if (insertedIds.length === 0) return;
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('property_events')
      .delete()
      .eq('id', insertedIds[0]);
    if (!error) {
      const check = await admin()
        .from('property_events')
        .select('id')
        .eq('id', insertedIds[0]);
      expect((check.data ?? []).length).toBe(1);
    }
  });
});
