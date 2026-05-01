/**
 * RLS tests for properties + property_images.
 *
 * Pairs with `src/db/migrations/0004_properties.sql`. Per CLAUDE.md hard rule
 * #2, every RLS policy in that migration is exercised here from the
 * appropriate tier — positive (allowed) and negative (denied) cases.
 *
 * Listing-cap enforcement is tested explicitly: set cap=2 via service role,
 * fill to cap, verify the next INSERT fails. The advisory-lock mechanism
 * inside `can_insert_listing()` makes this race-safe under concurrent
 * inserts; we test the deterministic at-cap behavior here.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  cleanupTestProperties,
  clientFor,
  ensureFixtures,
  fixtureUserId,
  type FixtureContext,
} from './_setup';

let ctx: FixtureContext;

beforeAll(async () => {
  ctx = await ensureFixtures();
});

afterAll(async () => {
  // Make sure listing_cap is reset and any test-only properties are gone.
  await admin()
    .from('organizations')
    .update({ listing_cap: 5 })
    .eq('id', ctx.orgAId);
  await cleanupTestProperties();
});

// ============================================================
// properties — SELECT
// ============================================================

describe('RLS · properties · SELECT', () => {
  it('an anonymous client reads the active+published listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('properties')
      .select('id, status, title_en')
      .eq('id', ctx.orgAActiveListingId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgAActiveListingId);
    expect(data?.status).toBe('active');
  });

  it('an anonymous client cannot see the draft listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('properties')
      .select('id')
      .eq('id', ctx.orgADraftListingId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('a registered user with no org sees only the active listing', async () => {
    const c = await clientFor('registered_a');
    const visibleIds = await c
      .from('properties')
      .select('id')
      .in('id', [ctx.orgAActiveListingId, ctx.orgADraftListingId]);
    expect(visibleIds.error).toBeNull();
    expect(visibleIds.data?.map((r) => r.id).sort()).toEqual([
      ctx.orgAActiveListingId,
    ]);
  });

  it('an org A member sees both active and draft of their org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('properties')
      .select('id')
      .in('id', [ctx.orgAActiveListingId, ctx.orgADraftListingId]);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(2);
  });

  it('an org A agent (non-owner) sees both active and draft', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('properties')
      .select('id')
      .in('id', [ctx.orgAActiveListingId, ctx.orgADraftListingId]);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(2);
  });

  it('an org B owner sees only the public-visible active listing of org A, not the draft', async () => {
    const c = await clientFor('agent_b_owner');
    const { data } = await c
      .from('properties')
      .select('id, status')
      .in('id', [ctx.orgAActiveListingId, ctx.orgADraftListingId]);
    // org B owner has no membership in org A, so they only see what's publicly visible.
    expect(data?.map((r) => r.id).sort()).toEqual([ctx.orgAActiveListingId]);
  });

  it('a platform admin sees both listings', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('properties')
      .select('id')
      .in('id', [ctx.orgAActiveListingId, ctx.orgADraftListingId]);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(2);
  });
});

// ============================================================
// properties — INSERT
// ============================================================

describe('RLS · properties · INSERT', () => {
  afterEach(async () => {
    await cleanupTestProperties();
  });

  it('an org owner can insert a draft listing into their own org', async () => {
    const c = await clientFor('agent_a_owner');
    const ownerId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('properties').insert({
      org_id: ctx.orgAId,
      created_by: ownerId,
      short_id: 'fixtestins1',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'draft',
      title_en: 'Test Insert',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
    });
    expect(error).toBeNull();
  });

  it('an org agent (non-owner) can insert a draft listing into their own org', async () => {
    const c = await clientFor('agent_a_agent');
    const userId = await fixtureUserId('agent_a_agent');
    const { error } = await c.from('properties').insert({
      org_id: ctx.orgAId,
      created_by: userId,
      short_id: 'fixtestins2',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'draft',
      title_en: 'Test Insert by Agent',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
    });
    expect(error).toBeNull();
  });

  it('an org A user cannot insert a property with org_id = org B', async () => {
    const c = await clientFor('agent_a_owner');
    const ownerId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('properties').insert({
      org_id: ctx.orgBId, // wrong org
      created_by: ownerId,
      short_id: 'fixtestxorg',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'draft',
      title_en: 'Should be blocked',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
    });
    expect(error).not.toBeNull();
  });

  it('a registered user with no org cannot insert a property', async () => {
    const c = await clientFor('registered_a');
    const userId = await fixtureUserId('registered_a');
    const { error } = await c.from('properties').insert({
      org_id: ctx.orgAId,
      created_by: userId,
      short_id: 'fixtestnouser',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'draft',
      title_en: 'Should be blocked',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
    });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// properties — listing-cap enforcement (advisory-lock-backed)
// ============================================================

describe('RLS · properties · listing-cap enforcement', () => {
  afterEach(async () => {
    // Always reset cap and clean up test rows after each cap test.
    await admin()
      .from('organizations')
      .update({ listing_cap: 5 })
      .eq('id', ctx.orgAId);
    await cleanupTestProperties();
  });

  it('an org at cap cannot publish a new active listing', async () => {
    // Fixture has 1 active in org A. Set cap to 2; insert one more to fill to
    // cap; then verify a 3rd-active insert is rejected by `can_insert_listing`.
    const a = admin();
    await a
      .from('organizations')
      .update({ listing_cap: 2 })
      .eq('id', ctx.orgAId);

    const owner = await clientFor('agent_a_owner');
    const ownerId = await fixtureUserId('agent_a_owner');

    // 2nd active — should succeed (count 1 -> 2).
    const r1 = await owner.from('properties').insert({
      org_id: ctx.orgAId,
      created_by: ownerId,
      short_id: 'fixtestcap1',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'active',
      title_en: 'Cap Test 1',
      slug_en: 'cap-test-1-santo-domingo',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
      published_at: new Date().toISOString(),
    });
    expect(r1.error).toBeNull();

    // 3rd active — should be blocked by the cap function.
    const r2 = await owner.from('properties').insert({
      org_id: ctx.orgAId,
      created_by: ownerId,
      short_id: 'fixtestcap2',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'active',
      title_en: 'Cap Test 2',
      slug_en: 'cap-test-2-santo-domingo',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
      published_at: new Date().toISOString(),
    });
    expect(r2.error).not.toBeNull();
  });

  it('drafts do not count toward the cap', async () => {
    // Set cap to 1. Fixture already has 1 active. New draft should still
    // succeed because drafts are excluded from the cap count.
    const a = admin();
    await a
      .from('organizations')
      .update({ listing_cap: 1 })
      .eq('id', ctx.orgAId);

    const owner = await clientFor('agent_a_owner');
    const ownerId = await fixtureUserId('agent_a_owner');
    const { error } = await owner.from('properties').insert({
      org_id: ctx.orgAId,
      created_by: ownerId,
      short_id: 'fixtestdrft',
      transaction_type: 'sale',
      property_type: 'apartment',
      status: 'draft', // draft — does not count
      title_en: 'Draft does not count',
      price_cents: 100_000,
      currency: 'USD',
      city: 'Santo Domingo',
      country_code: 'DO',
      location: 'SRID=4326;POINT(-69.92 18.47)',
    });
    expect(error).toBeNull();
  });
});

// ============================================================
// properties — UPDATE / DELETE
// ============================================================

describe('RLS · properties · UPDATE', () => {
  it('an org agent can update their own org\'s draft', async () => {
    const c = await clientFor('agent_a_agent');
    const { error } = await c
      .from('properties')
      .update({ title_en: 'AHO Fixture — Draft Listing (renamed)' })
      .eq('id', ctx.orgADraftListingId);
    expect(error).toBeNull();

    // Reset for idempotency.
    await admin()
      .from('properties')
      .update({ title_en: 'AHO Fixture — Draft Listing' })
      .eq('id', ctx.orgADraftListingId);
  });

  it('an org B owner cannot update an org A listing', async () => {
    const c = await clientFor('agent_b_owner');
    await c
      .from('properties')
      .update({ title_en: 'Hijack attempt' })
      .eq('id', ctx.orgAActiveListingId);
    // Verify via service role that nothing changed.
    const a = admin();
    const { data } = await a
      .from('properties')
      .select('title_en')
      .eq('id', ctx.orgAActiveListingId)
      .single();
    expect(data?.title_en).not.toBe('Hijack attempt');
  });
});

describe('RLS · properties · DELETE', () => {
  afterEach(async () => {
    await cleanupTestProperties();
  });

  it('a non-owner org member cannot DELETE properties', async () => {
    // Insert a temp property via service role first.
    const a = admin();
    const ownerId = await fixtureUserId('agent_a_owner');
    const inserted = await a
      .from('properties')
      .insert({
        org_id: ctx.orgAId,
        created_by: ownerId,
        short_id: 'fixtestdel1',
        transaction_type: 'sale',
        property_type: 'apartment',
        status: 'draft',
        title_en: 'Delete by non-owner attempt',
        price_cents: 100_000,
        currency: 'USD',
        city: 'Santo Domingo',
        country_code: 'DO',
        location: 'SRID=4326;POINT(-69.92 18.47)',
      })
      .select('id')
      .single();
    expect(inserted.error).toBeNull();
    const tempId = inserted.data!.id;

    const agent = await clientFor('agent_a_agent');
    await agent.from('properties').delete().eq('id', tempId);
    // Verify still exists.
    const { data } = await a.from('properties').select('id').eq('id', tempId);
    expect(data?.length ?? 0).toBe(1);
  });

  it('an org owner can DELETE their own org\'s property', async () => {
    const a = admin();
    const ownerId = await fixtureUserId('agent_a_owner');
    const inserted = await a
      .from('properties')
      .insert({
        org_id: ctx.orgAId,
        created_by: ownerId,
        short_id: 'fixtestdel2',
        transaction_type: 'sale',
        property_type: 'apartment',
        status: 'draft',
        title_en: 'Delete by owner',
        price_cents: 100_000,
        currency: 'USD',
        city: 'Santo Domingo',
        country_code: 'DO',
        location: 'SRID=4326;POINT(-69.92 18.47)',
      })
      .select('id')
      .single();
    expect(inserted.error).toBeNull();
    const tempId = inserted.data!.id;

    const owner = await clientFor('agent_a_owner');
    const { error } = await owner.from('properties').delete().eq('id', tempId);
    expect(error).toBeNull();

    const { data } = await a.from('properties').select('id').eq('id', tempId);
    expect(data?.length ?? 0).toBe(0);
  });
});

// ============================================================
// property_images
// ============================================================

describe('RLS · property_images · SELECT', () => {
  it('an anonymous client sees images of an active+published listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('property_images')
      .select('id, r2_key')
      .eq('id', ctx.orgAActiveListingImageId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgAActiveListingImageId);
  });

  it('an anonymous client cannot see images of a draft listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('property_images')
      .select('id')
      .eq('id', ctx.orgADraftListingImageId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('an org A member sees images of both active and draft listings', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('property_images')
      .select('id')
      .in('id', [
        ctx.orgAActiveListingImageId,
        ctx.orgADraftListingImageId,
      ]);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(2);
  });

  it('an org B owner cannot see org A draft listing images', async () => {
    const c = await clientFor('agent_b_owner');
    const { data } = await c
      .from('property_images')
      .select('id')
      .eq('id', ctx.orgADraftListingImageId);
    expect(data?.length ?? 0).toBe(0);
  });
});

describe('RLS · property_images · INSERT', () => {
  afterEach(async () => {
    // Clean up any test-inserted images.
    await admin()
      .from('property_images')
      .delete()
      .like('r2_key', 'fixtest/%');
  });

  it('an org agent can insert an image for their own org\'s property', async () => {
    const c = await clientFor('agent_a_agent');
    const { error } = await c.from('property_images').insert({
      property_id: ctx.orgADraftListingId,
      r2_key: 'fixtest/agent-insert.webp',
      alt_text_en: 'agent insert',
      width: 1280,
      height: 853,
      position: 1,
    });
    expect(error).toBeNull();
  });

  it('an org B owner cannot insert an image for an org A property', async () => {
    const c = await clientFor('agent_b_owner');
    const { error } = await c.from('property_images').insert({
      property_id: ctx.orgADraftListingId, // org A property
      r2_key: 'fixtest/cross-org.webp',
      alt_text_en: 'cross org attempt',
      width: 1280,
      height: 853,
      position: 1,
    });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// audit_log — public-read policy from migration 0014
// ============================================================

describe('RLS · audit_log · public-read of listing events (0014)', () => {
  // Insert audit_log rows via service role for both an active+published
  // listing and a draft. Only the active one should be visible to anon
  // and to unrelated authenticated users.
  let activeAuditId: string;
  let draftAuditId: string;
  let actorId: string;

  beforeAll(async () => {
    actorId = await fixtureUserId('agent_a_owner');
    const a = admin();

    const ins1 = await a
      .from('audit_log')
      .insert({
        kind: 'listing.marked_sold',
        actor_id: actorId,
        target_id: ctx.orgAActiveListingId,
        payload: { sold_price_cents: 12345600, sold_date: new Date().toISOString() },
      })
      .select('id')
      .single();
    if (ins1.error || !ins1.data) {
      throw new Error(`audit_log seed (active) failed: ${ins1.error?.message}`);
    }
    activeAuditId = ins1.data.id;

    const ins2 = await a
      .from('audit_log')
      .insert({
        kind: 'listing.price_changed',
        actor_id: actorId,
        target_id: ctx.orgADraftListingId,
        payload: { from_cents: 20000000, to_cents: 18000000 },
      })
      .select('id')
      .single();
    if (ins2.error || !ins2.data) {
      throw new Error(`audit_log seed (draft) failed: ${ins2.error?.message}`);
    }
    draftAuditId = ins2.data.id;
  });

  afterAll(async () => {
    await admin().from('audit_log').delete().in('id', [activeAuditId, draftAuditId]);
  });

  it('anonymous client reads audit_log row for an active+published listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('audit_log')
      .select('id, kind')
      .eq('id', activeAuditId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(activeAuditId);
  });

  it('anonymous client cannot read audit_log row for a draft listing', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('audit_log')
      .select('id')
      .eq('id', draftAuditId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('an unrelated authenticated user can read the active listing event but not the draft one', async () => {
    const c = await clientFor('agent_b_owner');
    const visible = await c
      .from('audit_log')
      .select('id')
      .in('id', [activeAuditId, draftAuditId]);
    expect(visible.error).toBeNull();
    expect(visible.data?.map((r) => r.id).sort()).toEqual([activeAuditId]);
  });
});

// ============================================================
// audit_log — INSERT policy from migration 0013
// ============================================================
//
// Pairs with `audit_log_self_insert`: authenticated users can INSERT only
// rows where actor_id matches their own auth.uid(). Anon has no INSERT
// policy at all. Phase 1B test-debt #1 from the strategic-doc audit —
// previously the policy shipped without a paired RLS test (CLAUDE.md
// hard rule #2).

describe('RLS · audit_log · INSERT (audit_log_self_insert, 0013)', () => {
  const insertedIds: string[] = [];

  afterAll(async () => {
    if (insertedIds.length > 0) {
      await admin().from('audit_log').delete().in('id', insertedIds);
    }
  });

  it('anonymous client cannot INSERT into audit_log', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('audit_log')
      .insert({
        kind: 'listing.price_changed',
        actor_id: null,
        target_id: ctx.orgAActiveListingId,
        payload: { from_cents: 100, to_cents: 200 },
      })
      .select('id');
    // Either RLS rejects with an error OR returns an empty result set
    // (Postgrest sometimes surfaces RLS denial as 0 rows + no error).
    if (!error) {
      expect(data?.length ?? 0).toBe(0);
    } else {
      expect(error).not.toBeNull();
    }
  });

  it('authenticated user can INSERT a row when actor_id = their own auth.uid()', async () => {
    const c = await clientFor('agent_a_owner');
    const selfId = await fixtureUserId('agent_a_owner');
    const { data, error } = await c
      .from('audit_log')
      .insert({
        kind: 'listing.price_changed',
        actor_id: selfId,
        target_id: ctx.orgAActiveListingId,
        payload: { from_cents: 100, to_cents: 200 },
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) insertedIds.push(data.id);
  });

  it('authenticated user CANNOT INSERT a row impersonating another actor_id', async () => {
    const c = await clientFor('agent_a_owner');
    const otherId = await fixtureUserId('agent_b_owner');
    const { data, error } = await c
      .from('audit_log')
      .insert({
        kind: 'listing.price_changed',
        actor_id: otherId, // not auth.uid() — must be denied
        target_id: ctx.orgAActiveListingId,
        payload: { from_cents: 100, to_cents: 200 },
      })
      .select('id');
    if (!error) {
      expect(data?.length ?? 0).toBe(0);
    } else {
      expect(error).not.toBeNull();
    }
  });

  it('authenticated user CANNOT INSERT with a NULL actor_id (only service-role does that)', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('audit_log')
      .insert({
        kind: 'listing.price_changed',
        actor_id: null,
        target_id: ctx.orgAActiveListingId,
        payload: { from_cents: 100, to_cents: 200 },
      })
      .select('id');
    if (!error) {
      expect(data?.length ?? 0).toBe(0);
    } else {
      expect(error).not.toBeNull();
    }
  });
});

// ============================================================
// Trigger · recompute_agent_stats (migration 0013)
// ============================================================
//
// Pairs with the AFTER INSERT/UPDATE/DELETE trigger on properties +
// the recompute_agent_stats(uuid) function from 0013. Audits flagged
// four branches as Phase 1A's blocker #2 (none had test coverage):
//
//   1. Admin-driven flip recomputes the OWNING agent's stats — proves
//      the trigger keys off coalesce(primary_agent_id, created_by),
//      not auth.uid().
//   2. AVG ignores NULL — confidential closings (sold_price_cents NULL
//      on the row) don't drag stats_avg_price_cents toward 0.
//   3. 12-month rolling window — sales > 12 months ago are excluded
//      from stats_sales_12mo but counted in stats_total_sales.
//   4. Reassignment — changing primary_agent_id triggers a recompute
//      for both the old and new owning agent.
//
// All tests use admin-client INSERT/UPDATE so we exercise the trigger
// without needing user-context RLS rights. Cleanup deletes the throw-
// away properties via the existing `cleanupTestProperties()` (matches
// short_id LIKE 'fixtest%'), and the DELETE itself fires the trigger
// to restore the agent's stats to the pre-test baseline.

describe('Trigger · recompute_agent_stats (0013)', () => {
  let ownerAId: string;
  let agentAId: string;

  beforeAll(async () => {
    ownerAId = await fixtureUserId('agent_a_owner');
    agentAId = await fixtureUserId('agent_a_agent');
  });

  afterEach(async () => {
    // Each test inserts properties with short_id 'fixtest...'; remove
    // them so the trigger fires DELETE and stats roll back. Order
    // matters: cleanup must complete before the next test reads stats.
    await cleanupTestProperties();
  });

  async function readStats(agentId: string) {
    const a = admin();
    const { data, error } = await a
      .from('profiles')
      .select(
        'stats_total_sales, stats_sales_12mo, stats_price_min_cents, stats_price_max_cents, stats_avg_price_cents',
      )
      .eq('id', agentId)
      .single();
    if (error || !data) {
      throw new Error(`stats read failed for ${agentId}: ${error?.message}`);
    }
    return data as {
      stats_total_sales: number;
      stats_sales_12mo: number;
      stats_price_min_cents: number | null;
      stats_price_max_cents: number | null;
      stats_avg_price_cents: number | null;
    };
  }

  async function insertSold(spec: {
    shortId: string;
    createdBy: string;
    primaryAgentId?: string | null;
    soldPriceCents: number | null;
    soldDate: string;
  }): Promise<string> {
    const a = admin();
    const { data, error } = await a
      .from('properties')
      .insert({
        org_id: ctx.orgAId,
        created_by: spec.createdBy,
        primary_agent_id: spec.primaryAgentId ?? null,
        short_id: spec.shortId,
        transaction_type: 'sale',
        property_type: 'apartment',
        status: 'sold',
        title_en: `AHO Trigger Test — ${spec.shortId}`,
        // slug_en + published_at required by the table-level CHECKs from
        // 0004 for any non-draft status (slug must be present alongside
        // title in the same language; published_at not null for public
        // states). slug_en is fixture-prefixed so the public-detail-page
        // filter (0019 hotfix) hides these from anon traffic.
        slug_en: `aho-fixture-trg-${spec.shortId}`,
        published_at: spec.soldDate,
        price_cents: 20_000_000,
        currency: 'USD',
        bedrooms: 2,
        bathrooms: 1,
        area_sqm: 80,
        city: 'Santo Domingo',
        country_code: 'DO',
        location: 'SRID=4326;POINT(-69.92 18.47)',
        sold_date: spec.soldDate,
        sold_price_cents: spec.soldPriceCents,
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`insertSold failed for ${spec.shortId}: ${error?.message}`);
    }
    return data.id as string;
  }

  // --- Branch 1: admin-driven flip credits the OWNING agent ---
  it('admin-context INSERT credits the OWNING agent (created_by), not the calling admin', async () => {
    const before = await readStats(ownerAId);
    await insertSold({
      shortId: 'fixtesttrg1',
      createdBy: ownerAId,
      soldPriceCents: 25_000_000,
      soldDate: new Date().toISOString(),
    });
    const after = await readStats(ownerAId);
    expect(after.stats_total_sales).toBe(before.stats_total_sales + 1);
    expect(after.stats_sales_12mo).toBe(before.stats_sales_12mo + 1);
    // Verify the admin user's stats are NOT touched. The trigger keys
    // off coalesce(primary_agent_id, created_by) — i.e. the property's
    // owner — never auth.uid(). If this assertion fails, admin-driven
    // flips are mistakenly attributing sales to the admin.
    const adminUserId = await fixtureUserId('admin');
    const adminStats = await readStats(adminUserId);
    // We don't know the admin's pre-test value, but the trigger should
    // never have written for them as a result of THIS insert. We assert
    // the recomputed-at timestamp is not bumped by checking the count
    // didn't increment from the only sold listing we just added.
    // (If stats_total_sales reflects this fixture, it would also reflect
    // any prior tests' inserts — so we assert the property is NOT in
    // the admin's owning set via a direct query.)
    const a = admin();
    const { count: adminOwnedSold } = await a
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sold')
      .or(`primary_agent_id.eq.${adminUserId},and(primary_agent_id.is.null,created_by.eq.${adminUserId})`);
    expect(adminOwnedSold ?? 0).toBe(0);
    expect(adminStats.stats_total_sales).toBe(0);
  });

  // --- Branch 2: AVG ignores NULL (confidential closings don't pull avg toward 0) ---
  it('AVG ignores NULL: a confidential closing (sold_price_cents = null) is excluded from stats_avg_price_cents', async () => {
    // Two sales by the same agent: one priced (10M cents = $100k), one
    // confidential (null price). The average should be 10M cents, NOT
    // 5M (which is what averaging-with-zero would produce).
    await insertSold({
      shortId: 'fixtesttrg2',
      createdBy: ownerAId,
      soldPriceCents: 10_000_000,
      soldDate: new Date().toISOString(),
    });
    await insertSold({
      shortId: 'fixtesttrg3',
      createdBy: ownerAId,
      soldPriceCents: null,
      soldDate: new Date().toISOString(),
    });
    const after = await readStats(ownerAId);
    // stats_total_sales counts BOTH (no filter on price); stats_avg
    // counts only the priced one.
    expect(after.stats_avg_price_cents).toBe(10_000_000);
    expect(after.stats_price_min_cents).toBe(10_000_000);
    expect(after.stats_price_max_cents).toBe(10_000_000);
  });

  // --- Branch 3: 12-month rolling window ---
  it('12-month window: sale > 12 months ago is in stats_total_sales but NOT in stats_sales_12mo', async () => {
    const before = await readStats(ownerAId);
    // 13 months ago.
    const oldDate = new Date();
    oldDate.setMonth(oldDate.getMonth() - 13);
    await insertSold({
      shortId: 'fixtesttrg4',
      createdBy: ownerAId,
      soldPriceCents: 30_000_000,
      soldDate: oldDate.toISOString(),
    });
    // Today.
    await insertSold({
      shortId: 'fixtesttrg5',
      createdBy: ownerAId,
      soldPriceCents: 40_000_000,
      soldDate: new Date().toISOString(),
    });
    const after = await readStats(ownerAId);
    // Both count toward stats_total_sales.
    expect(after.stats_total_sales).toBe(before.stats_total_sales + 2);
    // Only the recent one counts toward stats_sales_12mo.
    expect(after.stats_sales_12mo).toBe(before.stats_sales_12mo + 1);
  });

  // --- Branch 4: reassignment recomputes for BOTH agents ---
  it('reassigning primary_agent_id from agentA to agentB recomputes stats for both', async () => {
    const ownerBefore = await readStats(ownerAId);
    const agentBefore = await readStats(agentAId);
    // Insert a sold property credited to ownerA (primary_agent_id NULL,
    // created_by = ownerA → coalesced to ownerA).
    const propertyId = await insertSold({
      shortId: 'fixtesttrg6',
      createdBy: ownerAId,
      primaryAgentId: null,
      soldPriceCents: 50_000_000,
      soldDate: new Date().toISOString(),
    });
    const ownerAfterInsert = await readStats(ownerAId);
    expect(ownerAfterInsert.stats_total_sales).toBe(ownerBefore.stats_total_sales + 1);
    // Now reassign primary_agent_id to agentA (the agent, not owner).
    const a = admin();
    const { error: updErr } = await a
      .from('properties')
      .update({ primary_agent_id: agentAId })
      .eq('id', propertyId);
    expect(updErr).toBeNull();
    // Trigger should have recomputed for BOTH ownerA (decrement: the
    // listing no longer coalesces to them) AND agentA (increment).
    const ownerAfterReassign = await readStats(ownerAId);
    const agentAfterReassign = await readStats(agentAId);
    expect(ownerAfterReassign.stats_total_sales).toBe(ownerBefore.stats_total_sales);
    expect(agentAfterReassign.stats_total_sales).toBe(agentBefore.stats_total_sales + 1);
  });
});
