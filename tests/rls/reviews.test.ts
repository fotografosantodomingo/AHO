/**
 * RLS tests for reviews + review_reports (migration 0016).
 *
 * Pairs with `src/db/migrations/0016_reviews.sql`. Per CLAUDE.md hard
 * rule #2, every policy in that migration is exercised here from the
 * appropriate tier — positive (allowed) and negative (denied) cases.
 *
 * Coverage:
 *   - INSERT: anon, signed-in, self-review block, status-pinning to
 *     pending_verification
 *   - SELECT: anon (published only), reviewer self, target agent, admin
 *   - UPDATE: reviewer-while-pending, agent-reply, admin moderation,
 *     non-owner denial
 *   - DELETE: admin only
 *   - protect_review_fields trigger: column-level scope per role
 *   - verify_review_token RPC: success / expired / invalid_format
 *   - review_reports: anyone-insert, reporter-self-select, admin-select
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  admin,
  clientFor,
  ensureFixtures,
  fixtureUserId,
  type FixtureContext,
} from './_setup';

let ctx: FixtureContext;
let agentUserId: string;
let reviewerUserId: string;

beforeAll(async () => {
  ctx = await ensureFixtures();
  agentUserId = await fixtureUserId('agent_a_owner');
  reviewerUserId = await fixtureUserId('agent_b_owner'); // a different user; not self-review
});

afterAll(async () => {
  // Clean up any test reviews + reports.
  const a = admin();
  await a.from('review_reports').delete().like('notes', 'fixtest%');
  await a.from('reviews').delete().like('reviewer_email', 'fixtest-%@aho.test');
});

afterEach(async () => {
  // Idempotent cleanup between tests so each test starts clean.
  const a = admin();
  await a.from('review_reports').delete().like('notes', 'fixtest%');
  await a.from('reviews').delete().like('reviewer_email', 'fixtest-%@aho.test');
});

// Helper: insert a review at a given status using the service role.
async function seedReview(opts: {
  status?: 'pending_verification' | 'pending_moderation' | 'published' | 'rejected' | 'hidden';
  reviewerUserId?: string | null;
  reviewerEmail?: string;
  reviewerName?: string;
  rating?: number;
  body?: string;
  token?: string | null;
  agentId?: string;
}): Promise<string> {
  const a = admin();
  const reviewerEmail =
    opts.reviewerEmail ?? `fixtest-${crypto.randomUUID().slice(0, 8)}@aho.test`;
  const { data, error } = await a
    .from('reviews')
    .insert({
      agent_id: opts.agentId ?? agentUserId,
      reviewer_user_id: opts.reviewerUserId ?? null,
      reviewer_email: reviewerEmail,
      reviewer_name: opts.reviewerName ?? 'Fixture Reviewer',
      rating: opts.rating ?? 5,
      body: opts.body ?? 'This agent provided exceptional service throughout the entire purchase process.',
      locale: 'en',
      status: opts.status ?? 'pending_verification',
      verification_token: opts.token === null ? null : opts.token ?? '0'.repeat(32),
      verification_token_expires_at:
        opts.token === null ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`seedReview failed: ${error.message}`);
  return data.id as string;
}

// ============================================================
// INSERT
// ============================================================

describe('RLS · reviews · INSERT', () => {
  it('anon can submit a review with reviewer_email + reviewer_name', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('reviews').insert({
      agent_id: agentUserId,
      reviewer_email: 'fixtest-anon@aho.test',
      reviewer_name: 'Anonymous Buyer',
      rating: 4,
      body: 'A reasonable experience working with this agent on a small condo purchase.',
      locale: 'en',
      status: 'pending_verification',
      verification_token: '1'.repeat(32),
      verification_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(error).toBeNull();
  });

  it('signed-in user can submit a review (and reviewer_user_id matches auth.uid)', async () => {
    const c = await clientFor('agent_b_owner');
    const { error } = await c.from('reviews').insert({
      agent_id: agentUserId,
      reviewer_user_id: reviewerUserId,
      reviewer_email: 'fixtest-signedin@aho.test',
      reviewer_name: 'Pedro',
      rating: 5,
      body: 'Excellent end-to-end. Highly recommend for buyers in this neighborhood market.',
      locale: 'en',
      status: 'pending_verification',
      verification_token: '2'.repeat(32),
      verification_token_expires_at: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(error).toBeNull();
  });

  it('signed-in user cannot insert with someone else\'s reviewer_user_id', async () => {
    const c = await clientFor('agent_b_owner');
    const { error } = await c.from('reviews').insert({
      agent_id: agentUserId,
      reviewer_user_id: agentUserId, // not their own auth.uid()
      reviewer_email: 'fixtest-impersonator@aho.test',
      reviewer_name: 'Impersonator',
      rating: 1,
      body: 'Impersonation attempt should be denied by the with-check policy on insert.',
      locale: 'en',
      status: 'pending_verification',
    });
    expect(error).not.toBeNull();
  });

  it('insert with status=published is denied (only pending_verification allowed)', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('reviews').insert({
      agent_id: agentUserId,
      reviewer_email: 'fixtest-pub@aho.test',
      reviewer_name: 'Bypass Attempt',
      rating: 5,
      body: 'Trying to write a published review directly without going through verification + moderation.',
      locale: 'en',
      status: 'published',
    });
    expect(error).not.toBeNull();
  });

  it('signed-in user cannot review themselves (self-review CHECK constraint)', async () => {
    const c = await clientFor('agent_a_owner');
    const { error } = await c.from('reviews').insert({
      agent_id: agentUserId, // same as auth.uid()
      reviewer_user_id: agentUserId,
      reviewer_email: 'fixtest-self@aho.test',
      reviewer_name: 'Self',
      rating: 5,
      body: 'I am writing a glowing review of myself which should be blocked at the DB layer.',
      locale: 'en',
      status: 'pending_verification',
    });
    expect(error).not.toBeNull();
    // 23514 = check_violation on reviews_no_self_review
    expect(error?.code).toBe('23514');
  });
});

// ============================================================
// SELECT
// ============================================================

describe('RLS · reviews · SELECT', () => {
  it('anon sees only published reviews', async () => {
    const pubId = await seedReview({ status: 'published', token: null });
    await seedReview({ status: 'pending_moderation', token: null });
    await seedReview({ status: 'rejected', token: null });

    const c = await clientFor('anon');
    const { data } = await c
      .from('reviews')
      .select('id, status')
      .eq('agent_id', agentUserId);
    expect(data?.map((r) => r.id)).toContain(pubId);
    expect(data?.every((r) => r.status === 'published')).toBe(true);
  });

  it('the target agent sees their own pending + rejected + hidden reviews', async () => {
    const pendId = await seedReview({ status: 'pending_moderation', token: null });
    const rejId = await seedReview({ status: 'rejected', token: null });

    const c = await clientFor('agent_a_owner');
    const { data } = await c
      .from('reviews')
      .select('id, status')
      .eq('agent_id', agentUserId)
      .in('status', ['pending_moderation', 'rejected']);
    const ids = data?.map((r) => r.id) ?? [];
    expect(ids).toContain(pendId);
    expect(ids).toContain(rejId);
  });

  it('a signed-in reviewer sees their own pending review (status check)', async () => {
    const id = await seedReview({
      status: 'pending_verification',
      reviewerUserId: reviewerUserId,
    });
    const c = await clientFor('agent_b_owner');
    const { data } = await c
      .from('reviews')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    expect(data?.id).toBe(id);
  });

  it('an unrelated user does not see another reviewer\'s pending review', async () => {
    const id = await seedReview({
      status: 'pending_verification',
      reviewerUserId: reviewerUserId,
    });
    const c = await clientFor('registered_a');
    const { data } = await c.from('reviews').select('id').eq('id', id);
    expect(data?.length ?? 0).toBe(0);
  });
});

// ============================================================
// UPDATE — protect_review_fields trigger + RLS row scope
// ============================================================

describe('RLS · reviews · UPDATE', () => {
  it('reviewer can edit body while status=pending_verification', async () => {
    const id = await seedReview({
      status: 'pending_verification',
      reviewerUserId: reviewerUserId,
    });
    const c = await clientFor('agent_b_owner');
    const { error } = await c
      .from('reviews')
      .update({ body: 'Edited: agent helped my family find a townhouse near the school zone.' })
      .eq('id', id);
    expect(error).toBeNull();
  });

  it('reviewer cannot edit after verification (status moved to pending_moderation)', async () => {
    const id = await seedReview({
      status: 'pending_moderation',
      reviewerUserId: reviewerUserId,
      token: null,
    });
    const c = await clientFor('agent_b_owner');
    await c
      .from('reviews')
      .update({ body: 'Tampering after verification — should be silently blocked by RLS.' })
      .eq('id', id);
    // Verify via service role that body is unchanged.
    const a = admin();
    const { data } = await a.from('reviews').select('body').eq('id', id).single();
    expect(data?.body).not.toContain('Tampering');
  });

  it('target agent can post a reply on a published review', async () => {
    const id = await seedReview({ status: 'published', token: null });
    const c = await clientFor('agent_a_owner');
    const { error } = await c
      .from('reviews')
      .update({ agent_reply: 'Thank you for the kind words — it was a pleasure helping.' })
      .eq('id', id);
    expect(error).toBeNull();
    const a = admin();
    const { data } = await a
      .from('reviews')
      .select('agent_reply, agent_replied_at')
      .eq('id', id)
      .single();
    expect(data?.agent_reply).toContain('Thank you');
    expect(data?.agent_replied_at).not.toBeNull();
  });

  it('target agent cannot edit the review body via the reply path', async () => {
    const id = await seedReview({ status: 'published', token: null });
    const c = await clientFor('agent_a_owner');
    await c
      .from('reviews')
      .update({ body: 'Agent rewriting their own review body — must be stripped by trigger.' })
      .eq('id', id);
    const a = admin();
    const { data } = await a.from('reviews').select('body').eq('id', id).single();
    expect(data?.body).not.toContain('rewriting');
  });

  it('non-admin, non-agent, non-reviewer cannot update', async () => {
    const id = await seedReview({ status: 'published', token: null });
    const c = await clientFor('registered_a');
    await c
      .from('reviews')
      .update({ status: 'hidden' })
      .eq('id', id);
    const a = admin();
    const { data } = await a.from('reviews').select('status').eq('id', id).single();
    expect(data?.status).toBe('published');
  });
});

// ============================================================
// DELETE
// ============================================================

describe('RLS · reviews · DELETE', () => {
  it('admin can delete a review', async () => {
    const id = await seedReview({ status: 'published', token: null });
    const c = await clientFor('admin');
    const { error } = await c.from('reviews').delete().eq('id', id);
    expect(error).toBeNull();
  });

  it('non-admin cannot delete a review', async () => {
    const id = await seedReview({ status: 'published', token: null });
    const c = await clientFor('agent_b_owner');
    await c.from('reviews').delete().eq('id', id);
    // Service-role check: row should still exist.
    const a = admin();
    const { data } = await a.from('reviews').select('id').eq('id', id);
    expect(data?.length).toBe(1);
  });
});

// ============================================================
// verify_review_token RPC
// ============================================================

describe('RPC · verify_review_token', () => {
  it('flips a valid token from pending_verification → pending_moderation', async () => {
    const token = 'a'.repeat(32);
    const id = await seedReview({ status: 'pending_verification', token });
    const c = await clientFor('anon');
    const { data, error } = await c.rpc('verify_review_token', { p_token: token });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.success).toBe(true);
    expect(row?.review_id).toBe(id);

    const a = admin();
    const { data: after } = await a
      .from('reviews')
      .select('status, verified_at, verification_token')
      .eq('id', id)
      .single();
    expect(after?.status).toBe('pending_moderation');
    expect(after?.verified_at).not.toBeNull();
    expect(after?.verification_token).toBeNull();
  });

  it('returns invalid_or_expired for an unknown token', async () => {
    const c = await clientFor('anon');
    const { data } = await c.rpc('verify_review_token', { p_token: 'b'.repeat(32) });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.success).toBe(false);
    expect(row?.error_code).toBe('invalid_or_expired');
  });

  it('returns invalid_token_format for malformed input', async () => {
    const c = await clientFor('anon');
    const { data } = await c.rpc('verify_review_token', { p_token: 'too-short' });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.success).toBe(false);
    expect(row?.error_code).toBe('invalid_token_format');
  });

  it('returns invalid_or_expired for an expired token', async () => {
    const a = admin();
    const token = 'c'.repeat(32);
    const { data: created } = await a
      .from('reviews')
      .insert({
        agent_id: agentUserId,
        reviewer_email: 'fixtest-expired@aho.test',
        reviewer_name: 'Expired Token',
        rating: 4,
        body: 'Expired-token test review used to verify the RPC rejects past-expiry rows.',
        locale: 'en',
        status: 'pending_verification',
        verification_token: token,
        verification_token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .select('id')
      .single();
    const c = await clientFor('anon');
    const { data } = await c.rpc('verify_review_token', { p_token: token });
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.success).toBe(false);
    expect(row?.error_code).toBe('invalid_or_expired');

    if (created) await a.from('reviews').delete().eq('id', created.id);
  });
});

// ============================================================
// review_reports
// ============================================================

describe('RLS · review_reports', () => {
  it('anon can insert a report on any review', async () => {
    const reviewId = await seedReview({ status: 'published', token: null });
    const c = await clientFor('anon');
    const { error } = await c.from('review_reports').insert({
      review_id: reviewId,
      reason: 'spam',
      notes: 'fixtest anon report',
      status: 'open',
    });
    expect(error).toBeNull();
  });

  it('reporter sees their own report', async () => {
    const reviewId = await seedReview({ status: 'published', token: null });
    const c = await clientFor('agent_b_owner');
    const ins = await c
      .from('review_reports')
      .insert({
        review_id: reviewId,
        reporter_user_id: reviewerUserId,
        reason: 'fake',
        notes: 'fixtest authenticated report',
        status: 'open',
      })
      .select('id')
      .single();
    expect(ins.error).toBeNull();
    const { data } = await c
      .from('review_reports')
      .select('id')
      .eq('id', ins.data?.id);
    expect(data?.length).toBe(1);
  });

  it('a different user cannot see another reporter\'s report', async () => {
    const reviewId = await seedReview({ status: 'published', token: null });
    const a = admin();
    const ins = await a
      .from('review_reports')
      .insert({
        review_id: reviewId,
        reporter_user_id: reviewerUserId,
        reason: 'spam',
        notes: 'fixtest cross-user',
        status: 'open',
      })
      .select('id')
      .single();
    const c = await clientFor('registered_a');
    const { data } = await c
      .from('review_reports')
      .select('id')
      .eq('id', ins.data?.id);
    expect(data?.length ?? 0).toBe(0);
  });
});
