import { describe, expect, it, beforeEach, vi } from 'vitest';
import type Stripe from 'stripe';
import { PRIVATE_LISTING_DURATION_MS } from '@/lib/billing/private-listing-constants';

/**
 * Unit coverage for the $5 private-owner listing Stripe flow:
 *
 *   1. POST /api/sell/private/checkout-session — auth gate + happy path
 *   2. handlePrivateListingPurchase — buyer/amount/currency extraction
 *      + idempotency on the unique stripe_session_id index
 *   3. handlePrivateListingRefund — refunded_at stamping + property
 *      archival when the linked property was published via the same
 *      private-purchase flow
 *
 * Mocking strategy mirrors `cron-photo-import-retry.test.ts`:
 *   - `vi.hoisted` for the per-suite spies so the module-level
 *     `vi.mock(...)` factories can reference them.
 *   - Server-only side-effect imports (env, supabase clients) get
 *     no-op'd or replaced with chainable spies.
 *   - The actual route / handler module is imported INSIDE each test
 *     so a per-test mock setup is in place before module evaluation.
 */

const mocks = vi.hoisted(() => ({
  // Server-side Supabase
  serverClient: {
    auth: {
      getUser: vi.fn(),
    },
  },
  createServerSupabaseClient: vi.fn(),

  // Admin Supabase — exposed as a chain builder for INSERT/UPDATE/SELECT
  adminFromSpy: vi.fn(),
  createAdminClient: vi.fn(),

  // Stripe — only the surfaces our code touches
  stripeCheckoutSessionsCreate: vi.fn(),
  getStripeClient: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('@/lib/env', () => ({
  publicEnv: () => ({
    NEXT_PUBLIC_SITE_URL: 'https://advertisehomes.online',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  }),
  serverEnv: () => ({
    STRIPE_SECRET_KEY: 'sk_test_aho_unit',
    STRIPE_WEBHOOK_SECRET: 'whsec_aho_unit',
    SUPABASE_SERVICE_ROLE_KEY: 'srk_aho_unit',
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock('@/lib/billing/stripe', () => ({
  getStripeClient: mocks.getStripeClient,
  verifyWebhookEvent: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.serverClient.auth.getUser.mockReset();
  mocks.createServerSupabaseClient.mockReset();
  mocks.createServerSupabaseClient.mockResolvedValue(mocks.serverClient);
  mocks.adminFromSpy.mockReset();
  mocks.createAdminClient.mockReset();
  mocks.createAdminClient.mockReturnValue({ from: mocks.adminFromSpy });
  mocks.stripeCheckoutSessionsCreate.mockReset();
  mocks.getStripeClient.mockReset();
  mocks.getStripeClient.mockReturnValue({
    checkout: { sessions: { create: mocks.stripeCheckoutSessionsCreate } },
  });
  // Default env for the checkout-session route. Tests can override.
  process.env.STRIPE_PRICE_PRIVATE_LISTING_ONE_TIME = 'price_aho_unit';
});

// ─── Test fixtures ──────────────────────────────────────────────────

const TEST_USER_ID = '00000000-0000-0000-0000-000000000aaa';
const TEST_USER_EMAIL = 'owner@example.com';
const TEST_PROPERTY_ID = '00000000-0000-0000-0000-000000000bbb';
const TEST_SESSION_ID = 'cs_test_aho';
const TEST_PAYMENT_INTENT_ID = 'pi_test_aho';

function makeReq(body: unknown = {}): Request {
  return new Request(
    'https://advertisehomes.online/api/sell/private/checkout-session',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

// ─── 1. Checkout-session endpoint ───────────────────────────────────

describe('POST /api/sell/private/checkout-session', () => {
  it('returns 401 when no user session is present', async () => {
    mocks.serverClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    const { POST } = await import(
      '@/app/api/sell/private/checkout-session/route'
    );
    const res = await POST(makeReq() as never);
    expect(res.status).toBe(401);
    expect(mocks.stripeCheckoutSessionsCreate).not.toHaveBeenCalled();
  });

  it('returns 200 with a url field when the user is authenticated', async () => {
    mocks.serverClient.auth.getUser.mockResolvedValue({
      data: { user: { id: TEST_USER_ID, email: TEST_USER_EMAIL } },
      error: null,
    });
    mocks.stripeCheckoutSessionsCreate.mockResolvedValue({
      id: TEST_SESSION_ID,
      url: 'https://checkout.stripe.com/c/pay/cs_test_aho',
    });

    const { POST } = await import(
      '@/app/api/sell/private/checkout-session/route'
    );
    const res = await POST(makeReq({ locale: 'en' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; sessionId: string };
    expect(body.url).toContain('checkout.stripe.com');
    expect(body.sessionId).toBe(TEST_SESSION_ID);

    // Confirm the Stripe call used the right shape.
    const call = mocks.stripeCheckoutSessionsCreate.mock.calls[0]?.[0];
    expect(call?.mode).toBe('payment');
    expect(call?.client_reference_id).toBe(TEST_USER_ID);
    expect(call?.line_items?.[0]?.price).toBe('price_aho_unit');
    expect(call?.metadata?.aho_purpose).toBe('private_listing');
    expect(call?.metadata?.buyer_user_id).toBe(TEST_USER_ID);
    expect(call?.metadata?.renewal_property_id).toBe('');
  });

  it('forwards propertyId to Stripe metadata as renewal_property_id for renewals', async () => {
    mocks.serverClient.auth.getUser.mockResolvedValue({
      data: { user: { id: TEST_USER_ID, email: TEST_USER_EMAIL } },
      error: null,
    });
    mocks.stripeCheckoutSessionsCreate.mockResolvedValue({
      id: TEST_SESSION_ID,
      url: 'https://checkout.stripe.com/c/pay/cs_test_aho',
    });

    const { POST } = await import(
      '@/app/api/sell/private/checkout-session/route'
    );
    const res = await POST(
      makeReq({ locale: 'en', propertyId: TEST_PROPERTY_ID }) as never,
    );
    expect(res.status).toBe(200);
    const call = mocks.stripeCheckoutSessionsCreate.mock.calls[0]?.[0];
    expect(call?.metadata?.renewal_property_id).toBe(TEST_PROPERTY_ID);
  });
});

// ─── 2. Webhook handler: handlePrivateListingPurchase ───────────────

function buildSessionCompletedEvent(overrides: {
  eventId?: string;
  sessionId?: string;
  buyerUserId?: string;
  renewalPropertyId?: string;
  amountTotal?: number;
  currency?: string;
  createdEpochSec?: number;
  paymentIntent?: string | null;
} = {}): Stripe.Event {
  const session = {
    id: overrides.sessionId ?? TEST_SESSION_ID,
    object: 'checkout.session',
    mode: 'payment',
    payment_intent: overrides.paymentIntent ?? TEST_PAYMENT_INTENT_ID,
    amount_total: overrides.amountTotal ?? 500,
    currency: overrides.currency ?? 'usd',
    created: overrides.createdEpochSec ?? 1_715_000_000,
    metadata: {
      aho_purpose: 'private_listing',
      buyer_user_id: overrides.buyerUserId ?? TEST_USER_ID,
      renewal_property_id: overrides.renewalPropertyId ?? '',
    },
  };
  return {
    id: overrides.eventId ?? 'evt_test_aho_1',
    type: 'checkout.session.completed',
    data: { object: session },
  } as unknown as Stripe.Event;
}

/**
 * Builds a chainable mock of supabase-js's `.from(...)` method.
 *
 * Calls supabase-js typically chain like:
 *   from('x').insert({...})           → { error }
 *   from('x').select(...).eq(...).maybeSingle() → { data, error }
 *   from('x').update({...}).eq(...).is(...) → { error }
 *
 * Each test feeds a queue of responses keyed by table name. The chain
 * captures intermediate methods (.select/.eq/.is) by returning `this`
 * until a terminal `.maybeSingle()` / awaited result resolves.
 */
function buildAdminChain(queue: Map<string, Array<unknown>>) {
  return (table: string) => {
    const responses = queue.get(table) ?? [];
    // For terminal awaits (insert/update without .maybeSingle), we
    // resolve directly. For select-style chains, .maybeSingle() ends.
    const chain: Record<string, unknown> = {};
    let nextResponse = (): unknown =>
      responses.shift() ?? { data: null, error: null };
    const proxyTerminal = (): Promise<unknown> => Promise.resolve(nextResponse());

    chain.insert = vi.fn(() => proxyTerminal());
    chain.update = vi.fn(() => {
      // .update returns a chain — calls might tail with .eq().is() or
      // be awaited directly. Make the return both thenable and chainable.
      const updateChain: Record<string, unknown> = {
        eq: vi.fn(() => updateChain),
        is: vi.fn(() => updateChain),
        then: (onFulfilled: (v: unknown) => void) =>
          Promise.resolve(nextResponse()).then(onFulfilled),
      };
      return updateChain;
    });
    chain.select = vi.fn(() => {
      const selectChain: Record<string, unknown> = {
        eq: vi.fn(() => selectChain),
        is: vi.fn(() => selectChain),
        maybeSingle: vi.fn(() => proxyTerminal()),
      };
      return selectChain;
    });
    return chain;
  };
}

describe('handlePrivateListingPurchase', () => {
  it('inserts a listing_purchases row with the right buyer/amount/currency', async () => {
    const queue = new Map<string, Array<unknown>>([
      ['listing_purchases', [{ error: null }]],
    ]);
    mocks.adminFromSpy.mockImplementation(buildAdminChain(queue));

    const { handlePrivateListingPurchase } = await import(
      '@/lib/billing/handlers/private-listing-purchase'
    );

    await handlePrivateListingPurchase(
      buildSessionCompletedEvent({ amountTotal: 500, currency: 'usd' }),
    );

    // Verify the .insert payload via the spy on the chain.
    const fromCall = mocks.adminFromSpy.mock.calls[0]?.[0];
    expect(fromCall).toBe('listing_purchases');
    const chain = mocks.adminFromSpy.mock.results[0]?.value as {
      insert: ReturnType<typeof vi.fn>;
    };
    const insertedRow = chain.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedRow.buyer_user_id).toBe(TEST_USER_ID);
    expect(insertedRow.amount_cents).toBe(500);
    expect(insertedRow.currency).toBe('USD');
    expect(insertedRow.stripe_session_id).toBe(TEST_SESSION_ID);
    expect(insertedRow.stripe_payment_intent_id).toBe(TEST_PAYMENT_INTENT_ID);
    expect(insertedRow.property_id).toBeNull();

    // expires_at = paid_at + PRIVATE_LISTING_DURATION_MS. Reads from
    // the constants module so this test moves with future duration
    // changes without re-asserting the literal number. Pre-2026-05-24
    // this hardcoded 60 days, which masked the bug where the billing
    // handler was 60 but marketing promised 90.
    const paidAt = new Date(insertedRow.paid_at as string).getTime();
    const expiresAt = new Date(insertedRow.expires_at as string).getTime();
    expect(expiresAt - paidAt).toBe(PRIVATE_LISTING_DURATION_MS);
  });

  it('treats a duplicate-session insert (PG 23505) as success — idempotent', async () => {
    const queue = new Map<string, Array<unknown>>([
      [
        'listing_purchases',
        [{ error: { code: '23505', message: 'duplicate key' } }],
      ],
    ]);
    mocks.adminFromSpy.mockImplementation(buildAdminChain(queue));

    const { handlePrivateListingPurchase } = await import(
      '@/lib/billing/handlers/private-listing-purchase'
    );

    // Should NOT throw — duplicate sessions are the redelivery path.
    await expect(
      handlePrivateListingPurchase(buildSessionCompletedEvent()),
    ).resolves.toBeUndefined();
  });
});

// ─── 3. Refund handler ─────────────────────────────────────────────

function buildChargeRefundedEvent(overrides: {
  eventId?: string;
  paymentIntent?: string;
  createdEpochSec?: number;
} = {}): Stripe.Event {
  const charge = {
    id: 'ch_test_aho',
    object: 'charge',
    payment_intent: overrides.paymentIntent ?? TEST_PAYMENT_INTENT_ID,
    amount_refunded: 500,
  };
  return {
    id: overrides.eventId ?? 'evt_test_aho_refund_1',
    type: 'charge.refunded',
    created: overrides.createdEpochSec ?? 1_715_086_400,
    data: { object: charge },
  } as unknown as Stripe.Event;
}

describe('handlePrivateListingRefund', () => {
  it('stamps refunded_at on the matching purchase and archives the linked active property', async () => {
    // listing_purchases.select.eq.maybeSingle() → returns a row
    // properties.select.eq.maybeSingle() → returns a row
    // listing_purchases.update() → resolves OK
    // properties.update() → resolves OK
    const purchaseRow = {
      id: 'purchase-1',
      property_id: TEST_PROPERTY_ID,
      refunded_at: null,
    };
    const propertyRow = {
      id: TEST_PROPERTY_ID,
      status: 'active',
      published_via: 'private_purchase',
    };

    const queue = new Map<string, Array<unknown>>([
      [
        'listing_purchases',
        [
          { data: purchaseRow, error: null }, // first select.maybeSingle
          { error: null }, // update
        ],
      ],
      [
        'properties',
        [
          { data: propertyRow, error: null }, // select.maybeSingle
          { error: null }, // update
        ],
      ],
    ]);
    mocks.adminFromSpy.mockImplementation(buildAdminChain(queue));

    const { handlePrivateListingRefund } = await import(
      '@/lib/billing/handlers/private-listing-refund'
    );

    await handlePrivateListingRefund(buildChargeRefundedEvent());

    // Two .from('listing_purchases') calls: select + update.
    // Two .from('properties') calls: select + update.
    const tablesTouched = mocks.adminFromSpy.mock.calls.map((c) => c[0]);
    expect(tablesTouched).toContain('listing_purchases');
    expect(tablesTouched).toContain('properties');

    // The update on properties should set status='archived'.
    // Find the second properties chain and inspect its .update payload.
    const propertyResults = mocks.adminFromSpy.mock.results
      .map((r, i) => ({ i, value: r.value, table: tablesTouched[i] }))
      .filter((r) => r.table === 'properties');
    const propertyUpdateChain = propertyResults
      .map((r) => r.value as { update: ReturnType<typeof vi.fn> })
      .find((v) => v.update.mock.calls.length > 0);
    expect(propertyUpdateChain).toBeDefined();
    const updatePayload = propertyUpdateChain!.update.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(updatePayload?.status).toBe('archived');
  });

  it('is a no-op when no purchase row matches the PaymentIntent', async () => {
    const queue = new Map<string, Array<unknown>>([
      ['listing_purchases', [{ data: null, error: null }]],
    ]);
    mocks.adminFromSpy.mockImplementation(buildAdminChain(queue));

    const { handlePrivateListingRefund } = await import(
      '@/lib/billing/handlers/private-listing-refund'
    );

    await expect(
      handlePrivateListingRefund(
        buildChargeRefundedEvent({ paymentIntent: 'pi_unrelated' }),
      ),
    ).resolves.toBeUndefined();

    // Only the lookup happened; no updates issued.
    const tablesTouched = mocks.adminFromSpy.mock.calls.map((c) => c[0]);
    expect(tablesTouched).toEqual(['listing_purchases']);
  });

  it('does not archive a property published via agent_subscription even if a private-purchase refund matches', async () => {
    // Defense-in-depth: if a malformed purchase row points at an
    // agent-subscription property, the refund handler must NOT archive
    // that property (the subscription flow owns its lifecycle).
    const purchaseRow = {
      id: 'purchase-2',
      property_id: TEST_PROPERTY_ID,
      refunded_at: null,
    };
    const propertyRow = {
      id: TEST_PROPERTY_ID,
      status: 'active',
      published_via: 'agent_subscription',
    };
    const queue = new Map<string, Array<unknown>>([
      [
        'listing_purchases',
        [
          { data: purchaseRow, error: null },
          { error: null }, // update
        ],
      ],
      ['properties', [{ data: propertyRow, error: null }]],
    ]);
    mocks.adminFromSpy.mockImplementation(buildAdminChain(queue));

    const { handlePrivateListingRefund } = await import(
      '@/lib/billing/handlers/private-listing-refund'
    );

    await handlePrivateListingRefund(buildChargeRefundedEvent());

    // No properties.update call should have been issued.
    const propertyResults = mocks.adminFromSpy.mock.results
      .map((r, i) => ({ value: r.value, table: mocks.adminFromSpy.mock.calls[i]?.[0] }))
      .filter((r) => r.table === 'properties');
    for (const { value } of propertyResults) {
      const chain = value as { update: ReturnType<typeof vi.fn> };
      expect(chain.update.mock.calls.length).toBe(0);
    }
  });
});
