/**
 * RLS tests for `lead_routing_rules` and `lead_routing_state`.
 *
 * Pairs with `src/db/migrations/0040_lead_routing_rules.sql`. Per
 * CLAUDE.md hard rule #2, every RLS policy in that migration is
 * exercised here — positive and negative cases.
 *
 * Lead-routing-rules auth model recap (see migration header):
 *   - SELECT  → any org member of the rule's org
 *   - INSERT  → owner + manager only
 *   - UPDATE  → owner + manager only
 *   - DELETE  → owner + manager only
 *   - Admin   → all (escape hatch)
 *
 * lead_routing_state is service-role write + owner/manager SELECT.
 *
 * Fixtures: rules + state rows are created via the service-role admin
 * client (not part of the shared `_setup.ts` fixtures because no other
 * suite needs them). Created rows are cleaned up at the end of each
 * test that creates them, but the test file is otherwise idempotent
 * across runs.
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
const createdRuleIds: string[] = [];
const createdStateOrgIds: string[] = [];

beforeAll(async () => {
  ctx = await ensureFixtures();
});

afterAll(async () => {
  const a = admin();
  if (createdRuleIds.length > 0) {
    await a.from('lead_routing_rules').delete().in('id', createdRuleIds);
  }
  if (createdStateOrgIds.length > 0) {
    await a.from('lead_routing_state').delete().in('org_id', createdStateOrgIds);
  }
});

async function seedRule(args: {
  orgId: string;
  name: string;
  priority?: number;
  conditions?: Record<string, unknown>;
  action: Record<string, unknown>;
  isActive?: boolean;
}): Promise<string> {
  const a = admin();
  const { data, error } = await a
    .from('lead_routing_rules')
    .insert({
      org_id: args.orgId,
      name: args.name,
      priority: args.priority ?? 0,
      conditions: args.conditions ?? {},
      action: args.action,
      is_active: args.isActive ?? true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const id = data!.id as string;
  createdRuleIds.push(id);
  return id;
}

// ============================================================
// SELECT — any org member; cross-org isolation
// ============================================================

describe('RLS · lead_routing_rules · SELECT', () => {
  it('an anonymous client cannot read any routing rules', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: anon-readback-target',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('lead_routing_rules')
      .select('id')
      .eq('id', ruleId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a registered (no org) user cannot read any routing rules', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: registered-readback-target',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('lead_routing_rules')
      .select('id')
      .eq('id', ruleId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A owner reads org A rules', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: org-a-owner-readback',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('lead_routing_rules')
      .select('id, name')
      .eq('id', ruleId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ruleId);
  });

  it('an org A non-owner agent reads org A rules', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: org-a-agent-readback',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('lead_routing_rules')
      .select('id')
      .eq('id', ruleId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ruleId);
  });

  it('an org A owner cannot read org B rules', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgBId,
      name: 'fixture: org-b-isolation-target',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_b_owner') },
    });
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('lead_routing_rules')
      .select('id')
      .eq('id', ruleId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('a platform admin reads any org rules', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgBId,
      name: 'fixture: admin-readback-target',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_b_owner') },
    });
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('lead_routing_rules')
      .select('id')
      .eq('id', ruleId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ruleId);
  });
});

// ============================================================
// INSERT — owner+manager only
// ============================================================

describe('RLS · lead_routing_rules · INSERT', () => {
  it('an org A owner inserts a routing rule on org A', async () => {
    const c = await clientFor('agent_a_owner');
    const ownerId = await fixtureUserId('agent_a_owner');
    const { data, error } = await c
      .from('lead_routing_rules')
      .insert({
        org_id: ctx.orgAId,
        name: 'fixture: owner-insert',
        priority: 50,
        conditions: { city: 'Santo Domingo' },
        action: { type: 'assign', assign_to_user_id: ownerId },
        is_active: true,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) createdRuleIds.push(data.id as string);
  });

  it('an org A non-owner agent cannot insert a routing rule (role-gated)', async () => {
    const c = await clientFor('agent_a_agent');
    const ownerId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('lead_routing_rules').insert({
      org_id: ctx.orgAId,
      name: 'fixture: agent-insert-attempt',
      priority: 0,
      conditions: {},
      action: { type: 'assign', assign_to_user_id: ownerId },
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('an org A owner cannot insert a rule for org B (cross-org isolation)', async () => {
    const c = await clientFor('agent_a_owner');
    const ownerB = await fixtureUserId('agent_b_owner');
    const { error } = await c.from('lead_routing_rules').insert({
      org_id: ctx.orgBId,
      name: 'fixture: cross-org-insert-attempt',
      priority: 0,
      conditions: {},
      action: { type: 'assign', assign_to_user_id: ownerB },
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('a registered (no org) user cannot insert a routing rule', async () => {
    const c = await clientFor('registered_a');
    const ownerId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('lead_routing_rules').insert({
      org_id: ctx.orgAId,
      name: 'fixture: registered-insert-attempt',
      action: { type: 'assign', assign_to_user_id: ownerId },
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});

// ============================================================
// UPDATE — owner+manager only
// ============================================================

describe('RLS · lead_routing_rules · UPDATE', () => {
  it('an org A owner updates an org A rule', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: update-target-owner',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('lead_routing_rules')
      .update({ name: 'fixture: update-target-owner (updated)', priority: 99 })
      .eq('id', ruleId);
    expect(error).toBeNull();
    const a = admin();
    const after = await a
      .from('lead_routing_rules')
      .select('name, priority')
      .eq('id', ruleId)
      .single();
    expect(after.data?.priority).toBe(99);
  });

  it('an org A non-owner agent cannot update org A rules (role-gated)', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: update-target-agent',
      priority: 1,
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('agent_a_agent');
    const { error } = await c
      .from('lead_routing_rules')
      .update({ priority: 999 })
      .eq('id', ruleId);
    // RLS soft-denies UPDATE: no error, 0 rows affected.
    expect(error).toBeNull();
    const a = admin();
    const after = await a
      .from('lead_routing_rules')
      .select('priority')
      .eq('id', ruleId)
      .single();
    expect(after.data?.priority).toBe(1);
  });

  it('an org A owner cannot update org B rules (cross-org isolation)', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgBId,
      name: 'fixture: update-target-cross-org',
      priority: 7,
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_b_owner') },
    });
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('lead_routing_rules')
      .update({ priority: 999 })
      .eq('id', ruleId);
    expect(error).toBeNull();
    const a = admin();
    const after = await a
      .from('lead_routing_rules')
      .select('priority')
      .eq('id', ruleId)
      .single();
    expect(after.data?.priority).toBe(7);
  });
});

// ============================================================
// DELETE — owner+manager only
// ============================================================

describe('RLS · lead_routing_rules · DELETE', () => {
  it('an org A non-owner agent cannot delete an org A rule', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: delete-attempt-agent',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('agent_a_agent');
    const { error } = await c.from('lead_routing_rules').delete().eq('id', ruleId);
    expect(error).toBeNull(); // soft denial
    const a = admin();
    const still = await a
      .from('lead_routing_rules')
      .select('id')
      .eq('id', ruleId)
      .maybeSingle();
    expect(still.data?.id).toBe(ruleId);
  });

  it('an org A owner deletes an org A rule', async () => {
    const ruleId = await seedRule({
      orgId: ctx.orgAId,
      name: 'fixture: delete-target-owner',
      action: { type: 'assign', assign_to_user_id: await fixtureUserId('agent_a_owner') },
    });
    const c = await clientFor('agent_a_owner');
    const { error, data } = await c
      .from('lead_routing_rules')
      .delete()
      .eq('id', ruleId)
      .select('id');
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);
    // Drop from the cleanup list since it's already gone.
    const ix = createdRuleIds.indexOf(ruleId);
    if (ix >= 0) createdRuleIds.splice(ix, 1);
  });
});

// ============================================================
// lead_routing_state — service-role write, owner/manager SELECT
// ============================================================

describe('RLS · lead_routing_state', () => {
  it('an org A owner reads the cursor row for org A', async () => {
    // Seed a state row via service role.
    const a = admin();
    const upsert = await a.from('lead_routing_state').upsert(
      { org_id: ctx.orgAId, last_round_robin_index: 3 },
      { onConflict: 'org_id' },
    );
    expect(upsert.error).toBeNull();
    if (!createdStateOrgIds.includes(ctx.orgAId)) {
      createdStateOrgIds.push(ctx.orgAId);
    }

    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('lead_routing_state')
      .select('org_id, last_round_robin_index')
      .eq('org_id', ctx.orgAId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.last_round_robin_index).toBe(3);
  });

  it('an org A non-owner agent cannot read the cursor row (manager+ only)', async () => {
    const a = admin();
    await a.from('lead_routing_state').upsert(
      { org_id: ctx.orgAId, last_round_robin_index: 4 },
      { onConflict: 'org_id' },
    );
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('lead_routing_state')
      .select('last_round_robin_index')
      .eq('org_id', ctx.orgAId)
      .maybeSingle();
    expect(error).toBeNull();
    // Soft-denied: filter returns no row.
    expect(data).toBeNull();
  });

  it('an org A owner cannot insert into lead_routing_state (service-role write only)', async () => {
    // Use Org B id so the test is isolated even if Org A row already exists.
    const c = await clientFor('agent_a_owner');
    const { error } = await c.from('lead_routing_state').insert({
      org_id: ctx.orgBId,
      last_round_robin_index: 0,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});
