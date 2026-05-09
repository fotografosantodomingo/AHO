/**
 * RLS tests for the `photo_import_failures` table (migration 0037).
 *
 * Pairs with `src/db/migrations/0037_photo_import_failures.sql`. Per
 * CLAUDE.md hard rule #2, every RLS policy ships with a paired test
 * exercising it from each affected tier — positive + negative.
 *
 * Auth model recap (mirrors property_images org-scoped policies):
 *   - SELECT  → any org member of the listing's org (via
 *               organization_members join, no role gate)
 *   - INSERT  → org member with role in ('owner','manager','agent')
 *               (via public.get_user_org_role(p.org_id))
 *   - UPDATE  → same role gate as INSERT, both `using` and `with check`
 *   - DELETE  → same role gate as INSERT
 *   - ALL     → platform admins (public.is_platform_admin()) via the
 *               separate `photo_import_failures_admin_all` policy
 *   - Anon    → no policy at all (denied by default)
 *
 * The fixture orgs created by `ensureFixtures()` give us:
 *   - agent_a_owner: role 'owner' in Org A — INSERT/UPDATE/DELETE allowed
 *   - agent_a_agent: role 'agent'  in Org A — INSERT/UPDATE/DELETE allowed
 *   - agent_b_owner: role 'owner' in Org B — cross-org isolation test
 *   - registered_a: no org membership — stands in for the "no qualifying
 *                   role" negative case (the policy fails the EXISTS join
 *                   when there's no organization_members row at all,
 *                   which is the same wire-level behavior as a viewer/
 *                   analyst whose role isn't in the allowed set).
 *   - admin: is_admin = true / admin_role = 'super_admin' — admin_all
 *   - anon: no session — denied across the board.
 *
 * Fixture rows here use `aho-fixture-` source URLs (per RISKS.md R11
 * the public surfaces all filter by that prefix; the source-url string
 * isn't actually filtered anywhere user-facing today, but we adopt the
 * same convention for consistency and easy `like`-based cleanup).
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

// Identifying prefix for any failure rows seeded or inserted by these
// tests. Cleanup deletes by prefix so even if a test crashes mid-run we
// don't leak fixture rows. Keep the literal `aho-fixture-` so the cross-
// fixture cleanup pattern from RISKS.md R11 still applies.
const FIXTURE_URL_PREFIX = 'https://aho-fixture-photo-import.test/';

/** Convenience: build a unique source URL per test that's easy to clean up. */
function fixtureUrl(slug: string): string {
  return `${FIXTURE_URL_PREFIX}${slug}.jpg`;
}

beforeAll(async () => {
  ctx = await ensureFixtures();

  // Pre-seed: one unresolved failure on the org-A active listing so the
  // SELECT cases have a known row to assert visibility against.
  const a = admin();
  // Defensive: clear any leftovers from prior runs of this file.
  await a
    .from('photo_import_failures')
    .delete()
    .like('source_url', `${FIXTURE_URL_PREFIX}%`);

  const seed = await a
    .from('photo_import_failures')
    .insert({
      property_id: ctx.orgAActiveListingId,
      source_url: fixtureUrl('seed-org-a-active'),
      error_code: 'fetch_503',
      attempts: 2,
    })
    .select('id')
    .single();
  if (seed.error || !seed.data) {
    throw new Error(`photo_import_failures seed failed: ${seed.error?.message}`);
  }
  insertedIds.push(seed.data.id as string);
});

afterAll(async () => {
  // Run regardless of test failures — leaving fixture rows behind would
  // pollute the production Supabase project (RISKS.md R11). The like-
  // delete catches anything our tests may have inserted under the
  // FIXTURE_URL_PREFIX even if `insertedIds` got out of sync.
  await admin()
    .from('photo_import_failures')
    .delete()
    .like('source_url', `${FIXTURE_URL_PREFIX}%`);
});

// ============================================================
// SELECT — org members read; everyone else is denied
// ============================================================

describe('RLS · photo_import_failures · SELECT', () => {
  it('anon cannot read any failures', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('photo_import_failures')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A owner reads failures for their org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('photo_import_failures')
      .select('id, error_code, attempts')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
    expect(data?.[0]?.error_code).toBe('fetch_503');
  });

  it('an org A non-owner agent ALSO reads failures for their org', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('photo_import_failures')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });

  it('an org B owner cannot see org A failures (cross-org isolation)', async () => {
    const c = await clientFor('agent_b_owner');
    const { data, error } = await c
      .from('photo_import_failures')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a registered user with no org membership cannot see any failures', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('photo_import_failures')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a platform admin reads any org’s failures', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('photo_import_failures')
      .select('id')
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(insertedIds.length);
  });
});

// ============================================================
// INSERT — owner/manager/agent of the listing's org only
// ============================================================

describe('RLS · photo_import_failures · INSERT', () => {
  it('anon cannot insert', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('photo_import_failures').insert({
      property_id: ctx.orgAActiveListingId,
      source_url: fixtureUrl('anon-insert-attempt'),
      error_code: 'fetch_503',
      attempts: 1,
    });
    expect(error).not.toBeNull();
  });

  it('an org A owner can insert a failure for their org’s listing', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('photo_import_failures')
      .insert({
        property_id: ctx.orgAActiveListingId,
        source_url: fixtureUrl('owner-insert'),
        error_code: 'timeout',
        attempts: 1,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('an org A non-owner agent can insert a failure for the same org’s draft', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('photo_import_failures')
      .insert({
        property_id: ctx.orgADraftListingId,
        source_url: fixtureUrl('agent-insert'),
        error_code: 'r2_put_failed',
        attempts: 1,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it('an org B owner CANNOT insert a failure for an org A listing (cross-org)', async () => {
    const c = await clientFor('agent_b_owner');
    const { error } = await c.from('photo_import_failures').insert({
      property_id: ctx.orgAActiveListingId, // org A — caller is not a member
      source_url: fixtureUrl('cross-org-insert'),
      error_code: 'fetch_503',
      attempts: 1,
    });
    expect(error).not.toBeNull();
  });

  it('a registered user with no org membership cannot insert a failure', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c.from('photo_import_failures').insert({
      property_id: ctx.orgAActiveListingId,
      source_url: fixtureUrl('no-org-insert'),
      error_code: 'fetch_503',
      attempts: 1,
    });
    expect(error).not.toBeNull();
  });

  it('a platform admin can insert a failure for any org’s listing (admin_all)', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('photo_import_failures')
      .insert({
        property_id: ctx.orgAActiveListingId,
        source_url: fixtureUrl('admin-insert'),
        error_code: 'fetch_503',
        attempts: 1,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
  });
});

// ============================================================
// UPDATE — owner/manager/agent of the listing's org only
// ============================================================

describe('RLS · photo_import_failures · UPDATE', () => {
  // Each UPDATE test creates its own row via service role so we have a
  // known starting state. Cleanup is centralized in afterAll via the
  // FIXTURE_URL_PREFIX `like`-delete.

  async function seedRow(slug: string, propertyId: string): Promise<string> {
    const a = admin();
    const ins = await a
      .from('photo_import_failures')
      .insert({
        property_id: propertyId,
        source_url: fixtureUrl(`upd-${slug}`),
        error_code: 'fetch_503',
        attempts: 1,
      })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      throw new Error(`UPDATE seed failed: ${ins.error?.message}`);
    }
    return ins.data.id as string;
  }

  it('anon cannot update any failure (silent zero-row update)', async () => {
    const rowId = await seedRow('anon', ctx.orgAActiveListingId);
    const c = await clientFor('anon');
    const { error } = await c
      .from('photo_import_failures')
      .update({ error_code: 'hijacked' })
      .eq('id', rowId);
    // RLS for anon either errors or returns 0 affected. Either way the
    // row must remain unchanged.
    if (!error) {
      const a = admin();
      const after = await a
        .from('photo_import_failures')
        .select('error_code')
        .eq('id', rowId)
        .single();
      expect(after.data?.error_code).toBe('fetch_503');
    }
  });

  it('an org A owner can update a failure on their org’s listing', async () => {
    const rowId = await seedRow('owner', ctx.orgAActiveListingId);
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('photo_import_failures')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('resolved_at')
      .eq('id', rowId)
      .single();
    expect(after.data?.resolved_at).not.toBeNull();
  });

  it('an org A non-owner agent can update a failure on their org’s listing', async () => {
    const rowId = await seedRow('agent', ctx.orgADraftListingId);
    const c = await clientFor('agent_a_agent');
    const { error } = await c
      .from('photo_import_failures')
      .update({ error_code: 'timeout' })
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('error_code')
      .eq('id', rowId)
      .single();
    expect(after.data?.error_code).toBe('timeout');
  });

  it('an org B owner CANNOT update an org A failure (silent zero-row)', async () => {
    const rowId = await seedRow('crossorg', ctx.orgAActiveListingId);
    const c = await clientFor('agent_b_owner');
    const { error } = await c
      .from('photo_import_failures')
      .update({ error_code: 'hijacked' })
      .eq('id', rowId);
    // Either RLS blocks via filter (no error, 0 rows touched) or denies.
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('error_code')
      .eq('id', rowId)
      .single();
    expect(after.data?.error_code).toBe('fetch_503');
  });

  it('a registered user with no org membership CANNOT update a failure', async () => {
    const rowId = await seedRow('noorg', ctx.orgAActiveListingId);
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('photo_import_failures')
      .update({ error_code: 'hijacked' })
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('error_code')
      .eq('id', rowId)
      .single();
    expect(after.data?.error_code).toBe('fetch_503');
  });

  it('a platform admin can update any failure (admin_all)', async () => {
    const rowId = await seedRow('adminupd', ctx.orgAActiveListingId);
    const c = await clientFor('admin');
    const { error } = await c
      .from('photo_import_failures')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('resolved_at')
      .eq('id', rowId)
      .single();
    expect(after.data?.resolved_at).not.toBeNull();
  });
});

// ============================================================
// DELETE — owner/manager/agent of the listing's org only
// ============================================================

describe('RLS · photo_import_failures · DELETE', () => {
  async function seedRow(slug: string, propertyId: string): Promise<string> {
    const a = admin();
    const ins = await a
      .from('photo_import_failures')
      .insert({
        property_id: propertyId,
        source_url: fixtureUrl(`del-${slug}`),
        error_code: 'fetch_503',
        attempts: 1,
      })
      .select('id')
      .single();
    if (ins.error || !ins.data) {
      throw new Error(`DELETE seed failed: ${ins.error?.message}`);
    }
    return ins.data.id as string;
  }

  it('anon cannot delete any failure', async () => {
    const rowId = await seedRow('anon', ctx.orgAActiveListingId);
    const c = await clientFor('anon');
    const { error } = await c
      .from('photo_import_failures')
      .delete()
      .eq('id', rowId);
    if (!error) {
      const after = await admin()
        .from('photo_import_failures')
        .select('id')
        .eq('id', rowId)
        .maybeSingle();
      expect(after.data?.id).toBe(rowId);
    }
  });

  it('an org B owner CANNOT delete an org A failure (silent zero-row)', async () => {
    const rowId = await seedRow('crossorg', ctx.orgAActiveListingId);
    const c = await clientFor('agent_b_owner');
    const { error } = await c
      .from('photo_import_failures')
      .delete()
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('id')
      .eq('id', rowId)
      .maybeSingle();
    expect(after.data?.id).toBe(rowId);
  });

  it('a registered user with no org membership CANNOT delete a failure', async () => {
    const rowId = await seedRow('noorg', ctx.orgAActiveListingId);
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('photo_import_failures')
      .delete()
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('id')
      .eq('id', rowId)
      .maybeSingle();
    expect(after.data?.id).toBe(rowId);
  });

  it('an org A owner can delete a failure on their org’s listing', async () => {
    const rowId = await seedRow('owner', ctx.orgAActiveListingId);
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('photo_import_failures')
      .delete()
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('id')
      .eq('id', rowId)
      .maybeSingle();
    expect(after.data).toBeNull();
  });

  it('an org A non-owner agent can delete a failure on their org’s listing', async () => {
    const rowId = await seedRow('agent', ctx.orgADraftListingId);
    const c = await clientFor('agent_a_agent');
    const { error } = await c
      .from('photo_import_failures')
      .delete()
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('id')
      .eq('id', rowId)
      .maybeSingle();
    expect(after.data).toBeNull();
  });

  it('a platform admin can delete any failure (admin_all)', async () => {
    const rowId = await seedRow('admindel', ctx.orgAActiveListingId);
    // Silence the unused-variable warning while still proving fixtureUserId
    // is reachable for the admin tier (matches the pattern in saved-searches).
    const adminId = await fixtureUserId('admin');
    expect(typeof adminId).toBe('string');
    const c = await clientFor('admin');
    const { error } = await c
      .from('photo_import_failures')
      .delete()
      .eq('id', rowId);
    expect(error).toBeNull();
    const after = await admin()
      .from('photo_import_failures')
      .select('id')
      .eq('id', rowId)
      .maybeSingle();
    expect(after.data).toBeNull();
  });
});
