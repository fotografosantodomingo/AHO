/**
 * RLS tests for the identity tables: profiles, organizations, organization_members.
 *
 * Pairs with `src/db/migrations/0002_identity.sql`. Per CLAUDE.md hard rule #2,
 * every RLS policy in that migration is exercised here from the appropriate
 * tier — positive (allowed) and negative (denied) cases.
 *
 * Run with `pnpm test:rls`. Requires a dedicated test Supabase project
 * (see `tests/rls/_setup.ts` for env requirements).
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  clientFor,
  ensureFixtures,
  fixtureUserId,
  type FixtureContext,
} from './_setup';

let ctx: FixtureContext;

beforeAll(async () => {
  ctx = await ensureFixtures();
});

// ============================================================
// profiles
// ============================================================

describe('RLS · profiles', () => {
  it('a registered user reads their own profile', async () => {
    const c = await clientFor('registered_a');
    const meId = await fixtureUserId('registered_a');
    const { data, error } = await c
      .from('profiles')
      .select('id, email')
      .eq('id', meId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(meId);
  });

  it('a registered user sees zero rows for someone else’s profile', async () => {
    const c = await clientFor('registered_a');
    const otherId = await fixtureUserId('registered_b');
    const { data, error } = await c
      .from('profiles')
      .select('id')
      .eq('id', otherId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('an anonymous client sees zero profile rows', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c.from('profiles').select('id').limit(10);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('a platform admin reads every fixture profile', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('profiles')
      .select('id, email')
      .like('email', 'fixture-%@aho.test');
    expect(error).toBeNull();
    // 6 fixture users defined in _setup.ts
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('a registered user cannot escalate to is_admin via direct update', async () => {
    const c = await clientFor('registered_a');
    const meId = await fixtureUserId('registered_a');
    await c.from('profiles').update({ is_admin: true }).eq('id', meId);
    // Re-read via the service role to bypass RLS and confirm trigger behavior.
    const a = admin();
    const { data } = await a
      .from('profiles')
      .select('is_admin, admin_role')
      .eq('id', meId)
      .single();
    expect(data?.is_admin).toBe(false);
    expect(data?.admin_role).toBeNull();
  });

  it('a registered user can update their non-admin fields', async () => {
    const c = await clientFor('registered_a');
    const meId = await fixtureUserId('registered_a');
    const { error } = await c
      .from('profiles')
      .update({ full_name: 'Alice Tester' })
      .eq('id', meId);
    expect(error).toBeNull();
    const { data } = await c
      .from('profiles')
      .select('full_name')
      .eq('id', meId)
      .single();
    expect(data?.full_name).toBe('Alice Tester');
  });
});

// ============================================================
// organizations
// ============================================================

describe('RLS · organizations', () => {
  it('an org member reads their own org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('organizations')
      .select('id, slug')
      .eq('id', ctx.orgAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgAId);
  });

  it('an org member cannot see another org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('organizations')
      .select('id')
      .eq('id', ctx.orgBId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('a registered user with no org sees zero orgs', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c.from('organizations').select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('an org owner can update their own org name', async () => {
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('organizations')
      .update({ name: 'AHO Test Org A — renamed' })
      .eq('id', ctx.orgAId);
    expect(error).toBeNull();
    const { data } = await c
      .from('organizations')
      .select('name')
      .eq('id', ctx.orgAId)
      .single();
    expect(data?.name).toBe('AHO Test Org A — renamed');
  });

  it('a non-owner agent member cannot update their own org', async () => {
    const c = await clientFor('agent_a_agent');
    const { error } = await c
      .from('organizations')
      .update({ name: 'should not stick' })
      .eq('id', ctx.orgAId);
    // Update with no matching rows under RLS returns success with 0 rows
    // affected — verify the value didn't change instead of relying on error.
    expect(error).toBeNull();
    const a = admin();
    const { data } = await a
      .from('organizations')
      .select('name')
      .eq('id', ctx.orgAId)
      .single();
    expect(data?.name).not.toBe('should not stick');
  });

  it('an owner of org A cannot update org B', async () => {
    const c = await clientFor('agent_a_owner');
    await c
      .from('organizations')
      .update({ name: 'cross-org write attempt' })
      .eq('id', ctx.orgBId);
    const a = admin();
    const { data } = await a
      .from('organizations')
      .select('name')
      .eq('id', ctx.orgBId)
      .single();
    expect(data?.name).not.toBe('cross-org write attempt');
  });

  it('a platform admin sees every fixture org', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('organizations')
      .select('id')
      .like('slug', 'aho-test-org-%');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// organization_members
// ============================================================

describe('RLS · organization_members', () => {
  it('a user sees their own memberships', async () => {
    const c = await clientFor('agent_a_agent');
    const meId = await fixtureUserId('agent_a_agent');
    const { data, error } = await c
      .from('organization_members')
      .select('org_id, role')
      .eq('user_id', meId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('an org owner sees all members of their org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('organization_members')
      .select('user_id, role')
      .eq('org_id', ctx.orgAId);
    expect(error).toBeNull();
    // Org A has 2 members: owner + agent
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('a non-owner agent member cannot see other org members', async () => {
    // agent_a_agent should see only their own membership in org A,
    // not the owner's membership row.
    const c = await clientFor('agent_a_agent');
    const meId = await fixtureUserId('agent_a_agent');
    const { data } = await c
      .from('organization_members')
      .select('user_id')
      .eq('org_id', ctx.orgAId);
    expect(data?.length ?? 0).toBe(1);
    expect(data?.[0]?.user_id).toBe(meId);
  });

  it('an org owner cannot insert a member into another org', async () => {
    const c = await clientFor('agent_a_owner');
    const someoneId = await fixtureUserId('registered_a');
    const { error } = await c.from('organization_members').insert({
      org_id: ctx.orgBId,
      user_id: someoneId,
      role: 'agent',
    });
    expect(error).not.toBeNull();
  });

  it('an org owner can insert a member into their own org', async () => {
    const c = await clientFor('agent_a_owner');
    const newMemberId = await fixtureUserId('registered_a');
    // Idempotent: clean up first via service role if a previous run inserted.
    await admin()
      .from('organization_members')
      .delete()
      .eq('org_id', ctx.orgAId)
      .eq('user_id', newMemberId);
    const { error } = await c.from('organization_members').insert({
      org_id: ctx.orgAId,
      user_id: newMemberId,
      role: 'viewer',
    });
    expect(error).toBeNull();
    // Cleanup so the membership doesn't leak into other tests.
    await admin()
      .from('organization_members')
      .delete()
      .eq('org_id', ctx.orgAId)
      .eq('user_id', newMemberId);
  });
});
