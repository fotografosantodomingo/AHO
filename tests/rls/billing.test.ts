/**
 * RLS tests for the billing tables: plans, subscriptions, payments,
 * stripe_events_processed, founder_rate_grants.
 *
 * Pairs with `src/db/migrations/0003_billing.sql`. Per CLAUDE.md hard rule #2,
 * every RLS policy in that migration is exercised here from the appropriate
 * tier — positive (allowed) and negative (denied) cases.
 *
 * The fixture set in `_setup.ts` creates: one plan, one subscription on org A,
 * one successful payment for that subscription, one founder-rate grant for
 * the org A owner. Org B has no subscription / payments / grants — used to
 * test cross-org isolation.
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
// plans
// ============================================================

describe('RLS · plans', () => {
  it('an anonymous client reads visible+active plans', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('plans')
      .select('id, tier, amount_cents')
      .eq('id', ctx.planId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.planId);
  });

  it('a registered user reads visible+active plans (same as anon)', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c
      .from('plans')
      .select('id')
      .eq('id', ctx.planId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.planId);
  });

  it('an anonymous client cannot see invisible plans (founder rate)', async () => {
    // Make the fixture plan invisible temporarily, then verify anon can't see it.
    const a = admin();
    await a.from('plans').update({ is_visible: false }).eq('id', ctx.planId);
    try {
      const c = await clientFor('anon');
      const { data } = await c.from('plans').select('id').eq('id', ctx.planId);
      expect(data?.length ?? 0).toBe(0);
    } finally {
      await a.from('plans').update({ is_visible: true }).eq('id', ctx.planId);
    }
  });

  it('a platform admin sees plans regardless of visibility', async () => {
    const a = admin();
    await a.from('plans').update({ is_visible: false }).eq('id', ctx.planId);
    try {
      const c = await clientFor('admin');
      const { data, error } = await c.from('plans').select('id').eq('id', ctx.planId);
      expect(error).toBeNull();
      expect(data?.length ?? 0).toBe(1);
    } finally {
      await a.from('plans').update({ is_visible: true }).eq('id', ctx.planId);
    }
  });

  it('a registered user cannot insert a plan', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c.from('plans').insert({
      id: 'rogue_plan',
      tier: 'agent',
      billing_period: 'monthly',
      stripe_product_id: 'prod_rogue',
      stripe_price_id: 'price_rogue',
      display_name_en: 'Rogue',
      display_name_es: 'Rogue',
      amount_cents: 100,
    });
    expect(error).not.toBeNull();
  });
});

// ============================================================
// subscriptions
// ============================================================

describe('RLS · subscriptions', () => {
  it('an org A member sees the org A subscription', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('subscriptions')
      .select('id, status')
      .eq('id', ctx.orgASubscriptionId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgASubscriptionId);
  });

  it('an org A non-owner agent member sees the org A subscription (read-only)', async () => {
    const c = await clientFor('agent_a_agent');
    const { data, error } = await c
      .from('subscriptions')
      .select('id')
      .eq('id', ctx.orgASubscriptionId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgASubscriptionId);
  });

  it('an org B owner cannot see the org A subscription', async () => {
    const c = await clientFor('agent_b_owner');
    const { data } = await c
      .from('subscriptions')
      .select('id')
      .eq('id', ctx.orgASubscriptionId);
    expect(data?.length ?? 0).toBe(0);
  });

  it('a registered user with no org sees zero subscriptions', async () => {
    const c = await clientFor('registered_a');
    const { data } = await c.from('subscriptions').select('id');
    expect(data?.length ?? 0).toBe(0);
  });

  it('an anonymous client sees zero subscriptions', async () => {
    const c = await clientFor('anon');
    const { data } = await c.from('subscriptions').select('id');
    expect(data?.length ?? 0).toBe(0);
  });

  it('a platform admin sees all subscriptions', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('subscriptions')
      .select('id')
      .eq('id', ctx.orgASubscriptionId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(1);
  });

  it('an org member cannot update the subscription (writes go via service role)', async () => {
    const c = await clientFor('agent_a_owner');
    await c
      .from('subscriptions')
      .update({ status: 'cancelled' })
      .eq('id', ctx.orgASubscriptionId);
    const a = admin();
    const { data } = await a
      .from('subscriptions')
      .select('status')
      .eq('id', ctx.orgASubscriptionId)
      .single();
    expect(data?.status).toBe('active'); // unchanged
  });
});

// ============================================================
// payments
// ============================================================

describe('RLS · payments', () => {
  it('an org owner sees payments for their org', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('payments')
      .select('id, amount_cents')
      .eq('id', ctx.orgAPaymentId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgAPaymentId);
  });

  it('a non-owner agent member does NOT see payments by default', async () => {
    // The payment policy requires role in ('owner','manager') —
    // plain agents are intentionally excluded.
    const c = await clientFor('agent_a_agent');
    const { data } = await c
      .from('payments')
      .select('id')
      .eq('id', ctx.orgAPaymentId);
    expect(data?.length ?? 0).toBe(0);
  });

  it('an org B owner cannot see org A payments', async () => {
    const c = await clientFor('agent_b_owner');
    const { data } = await c
      .from('payments')
      .select('id')
      .eq('id', ctx.orgAPaymentId);
    expect(data?.length ?? 0).toBe(0);
  });

  it('an anonymous client sees zero payments', async () => {
    const c = await clientFor('anon');
    const { data } = await c.from('payments').select('id');
    expect(data?.length ?? 0).toBe(0);
  });
});

// ============================================================
// stripe_events_processed
// ============================================================

describe('RLS · stripe_events_processed', () => {
  it('an anonymous client sees zero rows', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c
      .from('stripe_events_processed')
      .select('stripe_event_id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('a platform admin also sees zero rows (no policy granting them access)', async () => {
    // RLS with no policies = nothing visible. Admin reads via service role
    // tooling, not via the user-context client.
    const c = await clientFor('admin');
    const { data } = await c.from('stripe_events_processed').select('stripe_event_id');
    expect(data?.length ?? 0).toBe(0);
  });

  it('the service-role client can write and read', async () => {
    const a = admin();
    const eventId = `evt_test_rls_${Date.now()}`;
    const { error: insertErr } = await a
      .from('stripe_events_processed')
      .insert({ stripe_event_id: eventId, event_type: 'rls.test' });
    expect(insertErr).toBeNull();
    const { data } = await a
      .from('stripe_events_processed')
      .select('stripe_event_id')
      .eq('stripe_event_id', eventId);
    expect(data?.length ?? 0).toBe(1);
    await a.from('stripe_events_processed').delete().eq('stripe_event_id', eventId);
  });
});

// ============================================================
// founder_rate_grants
// ============================================================

describe('RLS · founder_rate_grants', () => {
  it('the grant owner sees their own grant', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c
      .from('founder_rate_grants')
      .select('id, subscription_id')
      .eq('id', ctx.orgAFounderGrantId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(ctx.orgAFounderGrantId);
  });

  it('a different user does not see another user’s grant', async () => {
    const c = await clientFor('agent_b_owner');
    const { data } = await c
      .from('founder_rate_grants')
      .select('id')
      .eq('id', ctx.orgAFounderGrantId);
    expect(data?.length ?? 0).toBe(0);
  });

  it('an anonymous client sees zero grants', async () => {
    const c = await clientFor('anon');
    const { data } = await c.from('founder_rate_grants').select('id');
    expect(data?.length ?? 0).toBe(0);
  });

  it('a platform admin sees all grants', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('founder_rate_grants')
      .select('id')
      .eq('id', ctx.orgAFounderGrantId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(1);
  });
});
