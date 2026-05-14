/**
 * RLS tests for the `social_posts` + `social_post_attempts` tables.
 *
 * Pairs with `src/db/migrations/0052_social_posts.sql`. Per CLAUDE.md hard
 * rule #2, every RLS policy in that migration is exercised here —
 * positive and negative cases. Phase B of docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * Auth model recap (see migration header):
 *   - SELECT  → org members (any role) read rows attributed to their org
 *               (social_posts) or rows whose parent post is in their org
 *               (social_post_attempts).
 *   - INSERT / UPDATE / DELETE  → no user-context policy. Production
 *               writes go through createAdminClient() (service-role) in
 *               the publish-engine route + future workers. User-context
 *               writes are denied for every tier including the org's own
 *               members; that's the whole point — the publish state
 *               machine is owned by the server.
 *   - Admin policy on each table grants full access for support.
 *
 * Fixture pattern: this file creates its own social_posts + attempts via
 * the service-role client in beforeAll (idempotent), separate from the
 * shared FixtureContext. Cascade-deletes ride on the property FK so a
 * fixture-property delete cleans both tables for us.
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
let orgASocialPostId: string;
let orgASucceededAttemptId: string;
let orgAFailedAttemptId: string;

beforeAll(async () => {
  ctx = await ensureFixtures();
  const a = admin();
  const ownerAUserId = await fixtureUserId('agent_a_owner');

  // Idempotent: wipe any fixture social_posts on the active listing
  // first so each test run starts from a known state. Cascade clears
  // the attempts rows too.
  await a
    .from('social_posts')
    .delete()
    .eq('property_id', ctx.orgAActiveListingId);

  const created = await a
    .from('social_posts')
    .insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      user_id: ownerAUserId,
      requested_platforms: ['facebook', 'instagram'],
    })
    .select('id')
    .single();
  if (created.error) throw created.error;
  orgASocialPostId = created.data.id as string;

  const succeeded = await a
    .from('social_post_attempts')
    .insert({
      social_post_id: orgASocialPostId,
      platform: 'facebook',
      external_account_id: 'page:fixture-fb-page',
      status: 'succeeded',
      external_post_id: 'fixture_fb_page_post_1',
      external_post_url: 'https://facebook.com/fixture/posts/1',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (succeeded.error) throw succeeded.error;
  orgASucceededAttemptId = succeeded.data.id as string;

  const failed = await a
    .from('social_post_attempts')
    .insert({
      social_post_id: orgASocialPostId,
      platform: 'instagram',
      external_account_id: 'ig:fixture-ig-business',
      status: 'failed',
      error_code: 'image_too_large',
      error_message: 'Fixture: IG rejected image >8MB.',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (failed.error) throw failed.error;
  orgAFailedAttemptId = failed.data.id as string;
});

// ============================================================
// SELECT — social_posts
// ============================================================

describe('RLS · social_posts · SELECT', () => {
  it('an anonymous client cannot read any social_posts', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('social_posts')
      .select('id')
      .eq('id', orgASocialPostId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a registered (no org) user cannot read social_posts', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('social_posts')
      .select('id')
      .eq('id', orgASocialPostId);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A owner reads org A social_posts', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('social_posts')
      .select('id, org_id, requested_platforms')
      .eq('id', orgASocialPostId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(orgASocialPostId);
    expect(data?.org_id).toBe(ctx.orgAId);
    expect(data?.requested_platforms).toEqual(['facebook', 'instagram']);
  });

  it('an org A non-owner agent reads org A social_posts', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('social_posts')
      .select('id')
      .eq('id', orgASocialPostId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(orgASocialPostId);
  });

  it('an org B owner cannot read org A social_posts (cross-org isolation)', async () => {
    const c = await clientFor('agent_b_owner');
    const { data, error } = await c
      .from('social_posts')
      .select('id')
      .eq('id', orgASocialPostId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('a platform admin reads any org social_posts', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('social_posts')
      .select('id')
      .eq('id', orgASocialPostId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(orgASocialPostId);
  });
});

// ============================================================
// SELECT — social_post_attempts
// ============================================================

describe('RLS · social_post_attempts · SELECT', () => {
  it('an anonymous client cannot read attempts', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('social_post_attempts')
      .select('id')
      .in('id', [orgASucceededAttemptId, orgAFailedAttemptId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('an org A owner reads both succeeded + failed attempts on their org\'s post', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('social_post_attempts')
      .select('id, platform, status, external_post_id, error_code')
      .eq('social_post_id', orgASocialPostId);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      [orgASucceededAttemptId, orgAFailedAttemptId].sort(),
    );
    const fb = data?.find((r) => r.platform === 'facebook');
    expect(fb?.status).toBe('succeeded');
    expect(fb?.external_post_id).toBe('fixture_fb_page_post_1');
    const ig = data?.find((r) => r.platform === 'instagram');
    expect(ig?.status).toBe('failed');
    expect(ig?.error_code).toBe('image_too_large');
  });

  it('an org B owner cannot read org A attempts', async () => {
    const c = await clientFor('agent_b_owner');
    const { data, error } = await c
      .from('social_post_attempts')
      .select('id')
      .in('id', [orgASucceededAttemptId, orgAFailedAttemptId]);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it('a platform admin reads any attempts', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('social_post_attempts')
      .select('id')
      .in('id', [orgASucceededAttemptId, orgAFailedAttemptId]);
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.id).sort()).toEqual(
      [orgASucceededAttemptId, orgAFailedAttemptId].sort(),
    );
  });
});

// ============================================================
// INSERT — no user-context policy on either table. Even members of the
// post's own org cannot insert directly; production path uses service role.
// ============================================================

describe('RLS · social_posts + attempts · INSERT (deny-all-user-context)', () => {
  it('an anonymous client cannot insert a social_post', async () => {
    const c = await clientFor('anon');
    const ownerAUserId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('social_posts').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      user_id: ownerAUserId,
      requested_platforms: ['facebook'],
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('a registered user cannot insert a social_post', async () => {
    const c = await clientFor('registered_a');
    const ownerAUserId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('social_posts').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      user_id: ownerAUserId,
      requested_platforms: ['facebook'],
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('an org A owner cannot insert a social_post (writes are service-role only)', async () => {
    const c = await clientFor('agent_a_owner');
    const ownerAUserId = await fixtureUserId('agent_a_owner');
    const { error } = await c.from('social_posts').insert({
      property_id: ctx.orgAActiveListingId,
      org_id: ctx.orgAId,
      user_id: ownerAUserId,
      requested_platforms: ['facebook'],
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('an org A owner cannot insert a social_post_attempt', async () => {
    const c = await clientFor('agent_a_owner');
    const { error } = await c.from('social_post_attempts').insert({
      social_post_id: orgASocialPostId,
      platform: 'linkedin',
      external_account_id: 'urn:li:person:fixture',
      status: 'queued',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('42501');
  });
});

// ============================================================
// UPDATE / DELETE — no user-context policy. Even the org owner cannot
// retry / clear / cancel attempts directly; the publish-engine owns
// the lifecycle.
// ============================================================

describe('RLS · social_post_attempts · UPDATE (deny-all-user-context)', () => {
  it('an org A owner cannot UPDATE an attempt status', async () => {
    const c = await clientFor('agent_a_owner');
    const a = admin();
    const before = await a
      .from('social_post_attempts')
      .select('status, error_code')
      .eq('id', orgAFailedAttemptId)
      .single();
    // RLS denies the UPDATE silently — 0 rows affected, no error code
    // returned. (The user CAN see the row via SELECT, so the row passes
    // the read filter; the write hits the absent UPDATE policy and the
    // change just doesn't land.)
    const { error } = await c
      .from('social_post_attempts')
      .update({ status: 'succeeded', error_code: null })
      .eq('id', orgAFailedAttemptId);
    expect(error).toBeNull();
    const after = await a
      .from('social_post_attempts')
      .select('status, error_code')
      .eq('id', orgAFailedAttemptId)
      .single();
    expect(after.data?.status).toBe(before.data?.status);
    expect(after.data?.error_code).toBe(before.data?.error_code);
  });

  it('an org A owner cannot DELETE a social_post', async () => {
    const c = await clientFor('agent_a_owner');
    const a = admin();
    const { error } = await c
      .from('social_posts')
      .delete()
      .eq('id', orgASocialPostId);
    expect(error).toBeNull();
    // Row still exists (RLS treated the DELETE as a 0-row no-op).
    const { data } = await a
      .from('social_posts')
      .select('id')
      .eq('id', orgASocialPostId)
      .maybeSingle();
    expect(data?.id).toBe(orgASocialPostId);
  });
});

// ============================================================
// Idempotency — unique(social_post_id, external_account_id)
// ============================================================

describe('social_post_attempts · idempotency (unique constraint)', () => {
  it('a duplicate (social_post_id, external_account_id) insert fails with 23505', async () => {
    const a = admin();
    const { error } = await a.from('social_post_attempts').insert({
      social_post_id: orgASocialPostId,
      platform: 'facebook',
      external_account_id: 'page:fixture-fb-page', // already exists
      status: 'queued',
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505'); // unique_violation
  });

  it('the same (social_post_id, external_account_id) can be UPDATEd via service role', async () => {
    const a = admin();
    const { error: upErr } = await a
      .from('social_post_attempts')
      .update({
        status: 'failed',
        error_code: 'token_invalid',
        error_message: 'Updated by test',
      })
      .eq('id', orgASucceededAttemptId);
    expect(upErr).toBeNull();
    const { data } = await a
      .from('social_post_attempts')
      .select('status, error_code')
      .eq('id', orgASucceededAttemptId)
      .single();
    expect(data?.status).toBe('failed');
    expect(data?.error_code).toBe('token_invalid');

    // Restore the original so subsequent test files / re-runs see the
    // canonical fixture shape.
    await a
      .from('social_post_attempts')
      .update({
        status: 'succeeded',
        error_code: null,
        error_message: null,
      })
      .eq('id', orgASucceededAttemptId);
  });
});
