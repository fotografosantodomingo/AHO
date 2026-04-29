/**
 * RLS tests for the `leads` table.
 *
 * Pairs with `src/db/migrations/0009_leads.sql`. Per CLAUDE.md hard rule #2,
 * every RLS policy in that migration is exercised here — positive and
 * negative cases.
 *
 * Lead-specific auth model recap (see migration header):
 *   - SELECT  → org members (any role) read their org's leads
 *   - UPDATE  → org members with role owner/manager/agent
 *   - DELETE  → admins only (via the `for all` admin policy)
 *   - INSERT  → no policy. Production writes go through POST /api/leads
 *               with the service-role client; user-context INSERT is denied
 *               for both anonymous buyers and authenticated registered
 *               users. We test that explicit denial here.
 *
 * The fixture set in `_setup.ts` seeds two leads — one attributed to Org A
 * (the active listing's org) and one attributed to Org B — so cross-org
 * isolation is exercised end-to-end.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  clientFor,
  ensureFixtures,
  type FixtureContext,
} from './_setup';

let ctx: FixtureContext;

beforeAll(async () => {
  ctx = await ensureFixtures();
});

// ============================================================
// SELECT — anon + registered users see nothing
// ============================================================

describe('RLS · leads · SELECT', () => {
  it('an anonymous client cannot read any leads', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('leads')
      .select('id')
      .in('id', [ctx.orgALeadId, ctx.orgBLeadId]);
    expect(error).toBeNull();
    // RLS returns an empty array (not an error) for rows the user cannot see.
    expect(data ?? []).toHaveLength(0);
  });

  it('a registered (no org) user cannot read any leads', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('leads')
      .select('id')
      .in('id', [ctx.orgALeadId, ctx.orgBLeadId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A owner reads org A leads', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('leads')
      .select('id, org_id, contact_name')
      .eq('id', ctx.orgALeadId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgALeadId);
    expect(data?.org_id).toBe(ctx.orgAId);
  });

  it('an org A non-owner agent reads org A leads', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('leads')
      .select('id')
      .eq('id', ctx.orgALeadId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgALeadId);
  });

  it('an org A owner cannot read org B leads', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('leads')
      .select('id')
      .eq('id', ctx.orgBLeadId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('a platform admin reads any org leads', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('leads')
      .select('id')
      .in('id', [ctx.orgALeadId, ctx.orgBLeadId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      [ctx.orgALeadId, ctx.orgBLeadId].sort(),
    );
  });
});

// ============================================================
// UPDATE — org members in qualifying roles can update; others cannot
// ============================================================

describe('RLS · leads · UPDATE', () => {
  it('an org A owner updates lead status on org A leads', async () => {
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('leads')
      .update({ status: 'contacted', notes: 'fixture: owner update' })
      .eq('id', ctx.orgALeadId);
    expect(error).toBeNull();

    // Verify via admin client (RLS bypass) that the row actually changed.
    const a = admin();
    const { data } = await a
      .from('leads')
      .select('status, notes')
      .eq('id', ctx.orgALeadId)
      .single();
    expect(data?.status).toBe('contacted');
    expect(data?.notes).toBe('fixture: owner update');
  });

  it('an org A non-owner agent updates lead status on org A leads', async () => {
    const c = await clientFor('agent_a_agent');
    const { error } = await c
      .from('leads')
      .update({ status: 'qualified' })
      .eq('id', ctx.orgALeadId);
    expect(error).toBeNull();

    const a = admin();
    const { data } = await a
      .from('leads')
      .select('status')
      .eq('id', ctx.orgALeadId)
      .single();
    expect(data?.status).toBe('qualified');
  });

  it('an org A owner cannot update org B leads (cross-org isolation)', async () => {
    const c = await clientFor('agent_a_owner');
    // Capture the pre-update state so we can confirm nothing changed.
    const a = admin();
    const before = await a
      .from('leads')
      .select('status')
      .eq('id', ctx.orgBLeadId)
      .single();

    // The update silently affects 0 rows; RLS is filter-style, not error-style.
    const { error } = await c
      .from('leads')
      .update({ status: 'won' })
      .eq('id', ctx.orgBLeadId);
    expect(error).toBeNull();

    const after = await a
      .from('leads')
      .select('status')
      .eq('id', ctx.orgBLeadId)
      .single();
    expect(after.data?.status).toBe(before.data?.status);
  });

  it('a registered (no org) user cannot update any leads', async () => {
    const c = await clientFor('registered_a');
    const a = admin();
    const before = await a
      .from('leads')
      .select('status')
      .eq('id', ctx.orgALeadId)
      .single();
    const { error } = await c
      .from('leads')
      .update({ status: 'lost' })
      .eq('id', ctx.orgALeadId);
    expect(error).toBeNull();
    const after = await a
      .from('leads')
      .select('status')
      .eq('id', ctx.orgALeadId)
      .single();
    expect(after.data?.status).toBe(before.data?.status);
  });
});

// ============================================================
// INSERT — no user-context policy. Even members of the lead's org cannot
// insert directly; production path is POST /api/leads with service role.
// ============================================================

describe('RLS · leads · INSERT (deny-all-user-context)', () => {
  it('an anonymous client cannot insert a lead', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('leads').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      source: 'form',
      contact_name: 'Anon attempt',
      message: 'should be denied',
    });
    expect(error).not.toBeNull();
    // PostgREST surfaces RLS denial as 42501 / "new row violates row-level
    // security policy". Match by code so the message wording can change.
    expect(error?.code).toBe('42501');
  });

  it('a registered user cannot insert a lead', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c.from('leads').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      source: 'form',
      contact_name: 'Registered attempt',
      message: 'should be denied',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('an org A owner cannot insert a lead directly (no user-context policy)', async () => {
    // Even members of the listing's own org go through the API — the table
    // has no user-context INSERT policy at all. This catches a regression
    // where someone might add a permissive owner-INSERT policy to "fix" the
    // dashboard creating leads without realizing it opens spam vectors.
    const c = await clientFor('agent_a_owner');
    const { error } = await c.from('leads').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      source: 'form',
      contact_name: 'Owner attempt',
      message: 'should be denied',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});

// ============================================================
// DELETE — admins only. Org owners cannot delete.
// ============================================================

describe('RLS · leads · DELETE', () => {
  it('an org A owner cannot delete an org A lead', async () => {
    const c = await clientFor('agent_a_owner');
    // Create an extra lead via service role so the delete attempt has a
    // real target without consuming the fixture lead. We delete it after
    // the test to keep fixtures stable.
    const a = admin();
    const tmp = await a
      .from('leads')
      .insert({
        property_id: ctx.orgAActiveListingId,
        org_id: ctx.orgAId,
        source: 'form',
        contact_name: 'Delete-attempt target',
        contact_email: 'fixture-delete-target@aho.test',
        message: 'temp',
      })
      .select('id')
      .single();
    expect(tmp.error).toBeNull();
    const tmpId = tmp.data!.id as string;

    const { error } = await c.from('leads').delete().eq('id', tmpId);
    // RLS DELETE silently affects 0 rows — no error, but the row remains.
    expect(error).toBeNull();
    const after = await a.from('leads').select('id').eq('id', tmpId).maybeSingle();
    expect(after.data?.id).toBe(tmpId);

    // Cleanup so the next run starts from a clean state.
    await a.from('leads').delete().eq('id', tmpId);
  });

  it('a platform admin can delete a lead', async () => {
    const a = admin();
    const tmp = await a
      .from('leads')
      .insert({
        property_id: ctx.orgAActiveListingId,
        org_id: ctx.orgAId,
        source: 'form',
        contact_name: 'Admin-delete target',
        contact_email: 'fixture-admin-delete@aho.test',
        message: 'temp',
      })
      .select('id')
      .single();
    expect(tmp.error).toBeNull();
    const tmpId = tmp.data!.id as string;

    const c = await clientFor('admin');
    const { error } = await c.from('leads').delete().eq('id', tmpId);
    expect(error).toBeNull();

    const after = await a.from('leads').select('id').eq('id', tmpId).maybeSingle();
    expect(after.data).toBeNull();
  });
});

// ============================================================
// Helper RPC — get_listing_contact (SECURITY DEFINER)
// ============================================================

describe('RLS · get_listing_contact RPC', () => {
  it('returns contact info for an active+published listing to anon callers', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c.rpc('get_listing_contact', {
      p_property_id: ctx.orgAActiveListingId,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect((data as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('returns no rows for a draft (unpublished) listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c.rpc('get_listing_contact', {
      p_property_id: ctx.orgADraftListingId,
    });
    expect(error).toBeNull();
    expect((data as unknown[] | null) ?? []).toHaveLength(0);
  });
});
