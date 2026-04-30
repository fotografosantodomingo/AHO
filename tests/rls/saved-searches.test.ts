/**
 * RLS tests for the `saved_searches` table.
 *
 * Pairs with `src/db/migrations/0010_saved_searches.sql`. Per CLAUDE.md
 * hard rule #2, every RLS policy ships with a paired test.
 *
 * Auth model recap (from migration header):
 *   - SELECT  → owner only (user_id = auth.uid())
 *   - INSERT  → owner only (with check user_id = auth.uid())
 *   - UPDATE  → owner only (using + with check the same)
 *   - DELETE  → owner only
 *   - All four → admins via the `for all` admin policy
 *
 * Anonymous users have NO access (no anon policy at all).
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
// SELECT — owner sees own rows; nobody else
// ============================================================

describe('RLS · saved_searches · SELECT', () => {
  it('an anonymous client cannot read any saved searches', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('saved_searches')
      .select('id')
      .in('id', [ctx.registeredASavedSearchId, ctx.registeredBSavedSearchId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('registered_a reads own saved search', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('saved_searches')
      .select('id, name')
      .eq('id', ctx.registeredASavedSearchId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.registeredASavedSearchId);
    expect(data?.name).toContain('Fixture A');
  });

  it('registered_a cannot read registered_b saved search (owner isolation)', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('saved_searches')
      .select('id')
      .eq('id', ctx.registeredBSavedSearchId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('an org agent (with no own saved search) cannot read other users saved searches', async () => {
    // agent_a_owner did not create a saved search; verify they can't see
    // someone else's.
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('saved_searches')
      .select('id')
      .in('id', [ctx.registeredASavedSearchId, ctx.registeredBSavedSearchId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a platform admin reads any saved search', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('saved_searches')
      .select('id')
      .in('id', [ctx.registeredASavedSearchId, ctx.registeredBSavedSearchId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      [ctx.registeredASavedSearchId, ctx.registeredBSavedSearchId].sort(),
    );
  });
});

// ============================================================
// INSERT — owner only; user_id must match auth.uid()
// ============================================================

describe('RLS · saved_searches · INSERT', () => {
  it('registered_a inserts a saved search owned by themselves', async () => {
    const c = await clientFor('registered_a');
    const userId = await fixtureUserId('registered_a');
    const { data, error } = await c
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: 'Test insert — own user_id',
        filters: { city: 'La Romana' },
        locale: 'en',
        notify_email: false,
      })
      .select('id, user_id')
      .single();
    expect(error).toBeNull();
    expect(data?.user_id).toBe(userId);

    // Cleanup so the next run doesn't accumulate junk rows.
    if (data?.id) {
      const a = admin();
      await a.from('saved_searches').delete().eq('id', data.id);
    }
  });

  it('registered_a CANNOT insert a saved search owned by registered_b', async () => {
    const c = await clientFor('registered_a');
    const otherId = await fixtureUserId('registered_b');
    const { error } = await c.from('saved_searches').insert({
      user_id: otherId,
      name: 'Should be denied — wrong owner',
      filters: { city: 'La Romana' },
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('an anonymous client cannot insert any saved search', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('saved_searches').insert({
      user_id: '00000000-0000-0000-0000-000000000000',
      name: 'Anon attempt',
      filters: {},
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});

// ============================================================
// UPDATE — owner can update their own; cross-owner update blocked
// ============================================================

describe('RLS · saved_searches · UPDATE', () => {
  it('registered_a updates their own saved search', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('saved_searches')
      .update({ notify_email: false })
      .eq('id', ctx.registeredASavedSearchId);
    expect(error).toBeNull();

    const a = admin();
    const { data } = await a
      .from('saved_searches')
      .select('notify_email')
      .eq('id', ctx.registeredASavedSearchId)
      .single();
    expect(data?.notify_email).toBe(false);

    // Restore so subsequent test runs see the canonical fixture state.
    await a
      .from('saved_searches')
      .update({ notify_email: true })
      .eq('id', ctx.registeredASavedSearchId);
  });

  it('registered_a CANNOT update registered_b saved search (silent zero-row update)', async () => {
    const a = admin();
    const before = await a
      .from('saved_searches')
      .select('notify_email')
      .eq('id', ctx.registeredBSavedSearchId)
      .single();

    const c = await clientFor('registered_a');
    const { error } = await c
      .from('saved_searches')
      .update({ notify_email: false })
      .eq('id', ctx.registeredBSavedSearchId);
    expect(error).toBeNull(); // RLS is filter-style, not error-style

    const after = await a
      .from('saved_searches')
      .select('notify_email')
      .eq('id', ctx.registeredBSavedSearchId)
      .single();
    expect(after.data?.notify_email).toBe(before.data?.notify_email);
  });
});

// ============================================================
// DELETE — owner can delete their own; admin can delete any
// ============================================================

describe('RLS · saved_searches · DELETE', () => {
  it('registered_a CANNOT delete registered_b saved search', async () => {
    const a = admin();
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('saved_searches')
      .delete()
      .eq('id', ctx.registeredBSavedSearchId);
    expect(error).toBeNull();
    const after = await a
      .from('saved_searches')
      .select('id')
      .eq('id', ctx.registeredBSavedSearchId)
      .maybeSingle();
    expect(after.data?.id).toBe(ctx.registeredBSavedSearchId);
  });

  it('registered_a deletes own saved search', async () => {
    const a = admin();
    const userId = await fixtureUserId('registered_a');
    // Create a temp row to delete (don't kill the fixture).
    const tmp = await a
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: 'Temp — for delete test',
        filters: {},
      })
      .select('id')
      .single();
    expect(tmp.error).toBeNull();
    const tmpId = tmp.data!.id as string;

    const c = await clientFor('registered_a');
    const { error } = await c.from('saved_searches').delete().eq('id', tmpId);
    expect(error).toBeNull();

    const after = await a
      .from('saved_searches')
      .select('id')
      .eq('id', tmpId)
      .maybeSingle();
    expect(after.data).toBeNull();
  });

  it('a platform admin can delete any saved search', async () => {
    const a = admin();
    const userId = await fixtureUserId('registered_a');
    const tmp = await a
      .from('saved_searches')
      .insert({
        user_id: userId,
        name: 'Temp — admin delete target',
        filters: {},
      })
      .select('id')
      .single();
    expect(tmp.error).toBeNull();
    const tmpId = tmp.data!.id as string;

    const c = await clientFor('admin');
    const { error } = await c.from('saved_searches').delete().eq('id', tmpId);
    expect(error).toBeNull();

    const after = await a
      .from('saved_searches')
      .select('id')
      .eq('id', tmpId)
      .maybeSingle();
    expect(after.data).toBeNull();
  });
});
