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
