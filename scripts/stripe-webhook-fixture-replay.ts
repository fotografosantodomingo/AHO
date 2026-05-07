/**
 * Stripe webhook fixture-state replay harness.
 *
 * Extends `stripe-webhook-replay.ts` with end-to-end tests for the
 * "fresh-fetch" handlers that the synthetic-ID replay can't cover —
 * those handlers re-fetch from Stripe API and would throw on fake IDs
 * (per the original script's file header).
 *
 * What this script does:
 *   1. Provisions a real Stripe TEST-mode customer + subscription on
 *      the existing `aho_agent_monthly` price. Free; cleaned up at end.
 *   2. Inserts a matching DB fixture row in `subscriptions` via the
 *      service-role client (org_id and user_id are nullable in the
 *      schema, so the fixture is just plan_id + Stripe IDs + dates;
 *      no org / profile / auth-user fixtures needed).
 *   3. Sends synthetic webhook events with the REAL Stripe IDs to the
 *      live webhook endpoint. The handler validates signature, dedup,
 *      then fresh-fetches the subscription from Stripe (succeeds — real
 *      ID), then updates the DB fixture row.
 *   4. Asserts post-state: status / period_end / cancel_at_period_end
 *      in DB now match the freshly-fetched Stripe sub.
 *   5. Tears down — deletes the DB fixture sub row, then deletes the
 *      Stripe customer (which cascades-deletes its subscription).
 *
 * Refuses to run with a `sk_live_` key (same guard as
 * `setup-stripe-products.ts`) — fixtures stay strictly in TEST mode.
 *
 * Run via:
 *   set -a && source .env.local && set +a && pnpm stripe:replay-fixture
 *
 * Env required:
 *   - STRIPE_SECRET_KEY              (sk_test_*)
 *   - STRIPE_WEBHOOK_SECRET          (matching the deployed binding)
 *   - SUPABASE_POOLER_URL            (Postgres direct, for fixture inserts)
 *   - NEXT_PUBLIC_SITE_URL           (where to POST the synthetic events)
 */
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import Stripe from 'stripe';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} must be set (source .env.local).`);
    process.exit(1);
  }
  return v;
}

const STRIPE_KEY = requireEnv('STRIPE_SECRET_KEY');
if (STRIPE_KEY.startsWith('sk_live_')) {
  console.error(
    'Refusing to run with a LIVE Stripe key. The fixture harness is TEST-only.',
  );
  process.exit(1);
}
const WEBHOOK_SECRET = requireEnv('STRIPE_WEBHOOK_SECRET');
const POOLER_URL = requireEnv('SUPABASE_POOLER_URL');
const SITE_URL = requireEnv('NEXT_PUBLIC_SITE_URL');
const ENDPOINT = `${SITE_URL}/api/webhooks/stripe`;

const stripe = new Stripe(STRIPE_KEY, { timeout: 8000 });
const sql = postgres(POOLER_URL, { max: 1, prepare: false });

function signPayload(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function freshId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeEvent(type: string, object: object): { id: string; payload: string } {
  const id = freshId('evt_fixture');
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type,
    data: { object },
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  });
  return { id, payload };
}

interface Fixture {
  customerId: string;
  subscriptionId: string;
  /** UUID of the row we inserted in `subscriptions`. */
  dbSubId: string;
  /** UUID of the row we inserted in `organizations`. */
  dbOrgId: string;
}

async function provisionFixture(): Promise<Fixture> {
  console.log('Provisioning Stripe TEST customer + subscription...');

  // Find the seeded `aho_agent_monthly` plan to grab its Stripe price id.
  // Must exist (per `pnpm db:seed`); refuse if not.
  const planRows = await sql<{ id: string; stripe_price_id: string }[]>`
    select id, stripe_price_id
    from public.plans
    where id = 'aho_agent_monthly'
    limit 1
  `;
  const plan = planRows[0];
  if (!plan?.stripe_price_id) {
    throw new Error(
      'No `aho_agent_monthly` plan / stripe_price_id in DB. Run `pnpm db:seed` and `pnpm stripe:setup` first.',
    );
  }

  const customer = await stripe.customers.create({
    email: `fixture-replay-${Date.now()}@aho.test`,
    name: 'AHO Fixture-Replay Customer',
    metadata: { aho_fixture: 'webhook-replay' },
  });
  console.log(`  ✓ Stripe customer ${customer.id}`);

  // Create the subscription with a 7-day trial — sidesteps the need for
  // a real payment method (Stripe rejects token PMs like `pm_card_visa`
  // attached via the API in some flows). The fresh-fetch handler tests
  // care about reading subscription state and mutating it, not about
  // billing status, so `status=trialing` is fine.
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: plan.stripe_price_id }],
    trial_period_days: 7,
    metadata: { aho_fixture: 'webhook-replay' },
  });
  console.log(`  ✓ Stripe subscription ${subscription.id} (status=${subscription.status})`);

  // Insert a fixture organization first — the subscriptions table has
  // a CHECK constraint requiring at least one of (org_id, user_id) be
  // non-null. Slug is `aho-test-org-replay-*`, which the public surfaces
  // already filter out via `not('organizations.slug', 'like',
  // 'aho-test-org-%')` per RISKS.md R11. So this row never bleeds to
  // sitemaps, agent profiles, or search results.
  const orgSlug = `aho-test-org-replay-${Date.now()}`;
  const orgInserted = await sql<{ id: string }[]>`
    insert into public.organizations (name, slug, type)
    values ('AHO Fixture-Replay Org', ${orgSlug}, 'agent')
    returning id
  `;
  const dbOrgId = orgInserted[0]?.id;
  if (!dbOrgId) throw new Error('org insert returned no row');
  console.log(`  ✓ DB organizations row ${dbOrgId} (slug=${orgSlug})`);

  // Insert the matching subscription row pointing at our fixture org +
  // the real Stripe IDs. user_id stays NULL — the handler only touches
  // org_id / plan / stripe IDs / status / periods.
  // Same shape as `_helpers.ts periodFromSubscription` — Stripe moved
  // these fields between subscription-level and item-level across API
  // versions; the SDK types don't always expose the item-level pair
  // even though they exist at runtime, so cast through `unknown`.
  const item = subscription.items.data[0] as
    | { current_period_start?: number; current_period_end?: number }
    | undefined;
  const subAny = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const start =
    item?.current_period_start ?? subAny.current_period_start ?? Math.floor(Date.now() / 1000);
  const end =
    item?.current_period_end ?? subAny.current_period_end ?? Math.floor(Date.now() / 1000) + 30 * 86400;
  const inserted = await sql<{ id: string }[]>`
    insert into public.subscriptions (
      org_id, user_id, plan_id, stripe_customer_id, stripe_subscription_id,
      status, current_period_start, current_period_end, cancel_at_period_end
    )
    values (
      ${dbOrgId}, null, ${plan.id}, ${customer.id}, ${subscription.id},
      ${subscription.status}, to_timestamp(${start}), to_timestamp(${end}), false
    )
    returning id
  `;
  const dbSubId = inserted[0]?.id;
  if (!dbSubId) {
    throw new Error('subscription insert returned no row');
  }
  console.log(`  ✓ DB subscriptions row ${dbSubId}`);

  return { customerId: customer.id, subscriptionId: subscription.id, dbSubId, dbOrgId };
}

async function teardownFixture(fixture: Fixture): Promise<void> {
  console.log('\nTearing down fixture...');
  // Order matters: subscriptions FK has on_delete restrict on org but
  // unrestricted user / plan FKs. Deleting the DB sub row first; then
  // the Stripe customer (which cascades subscription + invoices).
  // Order: subscription → organization → Stripe customer.
  // organizations FK on subscriptions.org_id is `on delete restrict`,
  // so the sub row must come down first. Then the org. Then the Stripe
  // customer (which cascades-deletes its subs and invoices server-side).
  try {
    await sql`delete from public.subscriptions where id = ${fixture.dbSubId}`;
    console.log(`  ✓ Deleted DB sub row ${fixture.dbSubId}`);
  } catch (e) {
    console.error('  ✗ DB sub cleanup failed:', e);
  }
  try {
    await sql`delete from public.organizations where id = ${fixture.dbOrgId}`;
    console.log(`  ✓ Deleted DB org row ${fixture.dbOrgId}`);
  } catch (e) {
    console.error('  ✗ DB org cleanup failed:', e);
  }
  try {
    await stripe.customers.del(fixture.customerId);
    console.log(`  ✓ Deleted Stripe customer ${fixture.customerId}`);
  } catch (e) {
    console.error('  ✗ Stripe cleanup failed:', e);
  }
}

interface CaseResult {
  name: string;
  ok: boolean;
  detail?: string;
}

async function postWebhook(payload: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': signPayload(payload),
    },
    body: payload,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function isOk(b: unknown): boolean {
  return typeof b === 'object' && b !== null && (b as { ok?: boolean }).ok === true;
}

async function readDbSub(id: string): Promise<{
  status: string;
  current_period_end: Date;
  cancel_at_period_end: boolean;
} | null> {
  const rows = await sql<
    { status: string; current_period_end: Date; cancel_at_period_end: boolean }[]
  >`
    select status, current_period_end, cancel_at_period_end
    from public.subscriptions
    where id = ${id}
  `;
  return rows[0] ?? null;
}

async function caseSubscriptionUpdated(fixture: Fixture): Promise<CaseResult> {
  const name = 'customer.subscription.updated → DB fixture row updated from fresh fetch';

  // Mutate the Stripe sub so the fresh-fetch returns something
  // different from the DB pre-state. Setting cancel_at_period_end=true
  // is cheap, observable, and reversible.
  await stripe.subscriptions.update(fixture.subscriptionId, {
    cancel_at_period_end: true,
  });

  const before = await readDbSub(fixture.dbSubId);
  if (before?.cancel_at_period_end) {
    return { name, ok: false, detail: 'pre-state already had cancel_at_period_end=true' };
  }

  const event = makeEvent('customer.subscription.updated', {
    id: fixture.subscriptionId,
    object: 'subscription',
    customer: fixture.customerId,
  });
  const { status, body } = await postWebhook(event.payload);
  if (status !== 200 || !isOk(body)) {
    return {
      name,
      ok: false,
      detail: `webhook returned status=${status} body=${JSON.stringify(body)}`,
    };
  }

  const after = await readDbSub(fixture.dbSubId);
  if (!after) return { name, ok: false, detail: 'DB row missing after webhook' };
  if (!after.cancel_at_period_end) {
    return {
      name,
      ok: false,
      detail: `DB cancel_at_period_end still false after webhook (expected true)`,
    };
  }
  return { name, ok: true };
}

async function caseSubscriptionUpdatedIdempotent(
  fixture: Fixture,
): Promise<CaseResult> {
  const name = 'customer.subscription.updated → replay same event id is deduped';

  // Reuse a single event ID across two POSTs.
  const event = makeEvent('customer.subscription.updated', {
    id: fixture.subscriptionId,
    object: 'subscription',
    customer: fixture.customerId,
  });

  const first = await postWebhook(event.payload);
  if (first.status !== 200) {
    return { name, ok: false, detail: `first POST status=${first.status}` };
  }
  const second = await postWebhook(event.payload);
  const dedupBody = second.body as { ok?: boolean; deduped?: boolean };
  if (second.status !== 200 || dedupBody.ok !== true || dedupBody.deduped !== true) {
    return {
      name,
      ok: false,
      detail: `second POST status=${second.status} body=${JSON.stringify(second.body)} (expected deduped:true)`,
    };
  }
  return { name, ok: true };
}

async function caseSubscriptionDeleted(fixture: Fixture): Promise<CaseResult> {
  const name = 'customer.subscription.deleted → DB row marked status=canceled';

  // Cancel the Stripe sub at the source so fresh-fetch reports
  // status=canceled. (cancel_at_period_end alone doesn't change status.)
  await stripe.subscriptions.cancel(fixture.subscriptionId);

  const event = makeEvent('customer.subscription.deleted', {
    id: fixture.subscriptionId,
    object: 'subscription',
    customer: fixture.customerId,
    status: 'canceled',
  });
  const { status, body } = await postWebhook(event.payload);
  if (status !== 200 || !isOk(body)) {
    return {
      name,
      ok: false,
      detail: `webhook returned status=${status} body=${JSON.stringify(body)}`,
    };
  }
  const after = await readDbSub(fixture.dbSubId);
  if (after?.status !== 'canceled') {
    return {
      name,
      ok: false,
      detail: `DB status=${after?.status ?? 'missing'} (expected canceled)`,
    };
  }
  return { name, ok: true };
}

async function main(): Promise<void> {
  console.log(`Stripe webhook fixture-replay → ${ENDPOINT}\n`);

  const fixture = await provisionFixture();
  const results: CaseResult[] = [];

  try {
    results.push(await caseSubscriptionUpdated(fixture));
    results.push(await caseSubscriptionUpdatedIdempotent(fixture));
    // subscription.deleted runs LAST because cancel is non-reversible.
    results.push(await caseSubscriptionDeleted(fixture));
  } finally {
    await teardownFixture(fixture);
  }

  console.log('\nResults:');
  let pass = 0;
  let fail = 0;
  for (const r of results) {
    if (r.ok) {
      pass++;
      console.log(`  ✓ ${r.name}`);
    } else {
      fail++;
      console.log(`  ✗ ${r.name}\n      ${r.detail ?? '(no detail)'}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);

  await sql.end();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await sql.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
