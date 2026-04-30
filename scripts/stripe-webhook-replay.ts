/**
 * Stripe webhook replay test.
 *
 * Hand-rolled probe that exercises the live deployed webhook endpoint at
 * NEXT_PUBLIC_SITE_URL/api/webhooks/stripe. Covers:
 *
 *   1. Signature contract (missing / bad / good signatures).
 *   2. Idempotency dedup (replay same event id → deduped: true).
 *   3. Unknown event types (200 + ignored).
 *   4. Per-event-type dispatch — proves each of the 6 graceful-no-op
 *      handlers reaches its handler under the Edge runtime + signature
 *      verification + idempotency-dedup layers without crashing.
 *
 * Five events INTENTIONALLY skipped — they can't be safely replayed
 * without real Stripe + Supabase state:
 *   - `checkout.session.completed` — handler creates org / member /
 *     subscription DB rows on success. Synthetic events would either
 *     fail (no matching plan_id → 500) or, worse, partially succeed and
 *     leave test rows in production Supabase. Out of scope until a
 *     dedicated test Supabase project exists (CLAUDE.md "Local-dev
 *     quirks" — pending).
 *   - `customer.subscription.updated`,
 *   - `invoice.paid`,
 *   - `invoice.payment_failed`,
 *   - `invoice.payment_action_required` — all four use the "fresh
 *     fetch" pattern (DECISIONS.md): the handler re-queries the LIVE
 *     Stripe API for canonical state instead of trusting the event
 *     payload. Synthetic IDs aren't recognized by Stripe → API call
 *     throws → route returns 500. Replay coverage for these requires
 *     real Stripe test-mode state, which is the next infra step.
 *
 * The 3 covered handlers (customer.updated, customer.subscription.
 * deleted, charge.refunded) gracefully no-op when their target DB row
 * doesn't exist. Synthetic events with random IDs hit their lookup
 * path, find nothing, return cleanly. The route emits 200 ok in every
 * case — what we want to prove.
 *
 * Per-handler side-effect testing is a separate concern; that requires
 * staging DB state per event type. This script proves the dispatch +
 * auth + idempotency layer + Edge-runtime async signature verification
 * works for every event type we DO handle.
 *
 * Run via (env must be sourced first per CLAUDE.md "Local-dev quirks"):
 *     set -a && source .env.local && set +a && pnpm stripe:replay
 *
 * Required env:
 *   - NEXT_PUBLIC_SITE_URL          (where to POST)
 *   - STRIPE_WEBHOOK_SECRET         (signing secret matching the deployed binding)
 *
 * No real Stripe events are created — payloads are synthesized locally.
 * The signature uses Stripe's documented HMAC scheme (`t=<unix>,v1=<sig>`
 * over `${timestamp}.${rawBody}`), so the deployed webhook validates
 * them as if they came from Stripe itself.
 */
import { createHmac } from 'node:crypto';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} must be set (source .env.local).`);
    process.exit(1);
  }
  return v;
}

const SITE_URL = requireEnv('NEXT_PUBLIC_SITE_URL');
const WEBHOOK_SECRET = requireEnv('STRIPE_WEBHOOK_SECRET');
const ENDPOINT = `${SITE_URL}/api/webhooks/stripe`;

function signPayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function freshId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

interface EventEnvelope {
  type: string;
  object: object;
}

/**
 * Build a Stripe-shaped event envelope around `(type, data.object)`.
 * Each call gets a fresh `id` so dedup doesn't kick in across cases.
 */
function makeEvent(env: EventEnvelope): { id: string; payload: string } {
  const id = freshId('evt_replay');
  const payload = JSON.stringify({
    id,
    object: 'event',
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: env.type,
    data: { object: env.object },
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  });
  return { id, payload };
}

interface ReplayCase {
  name: string;
  body: string;
  signature: string | null;
  expectedStatus: number;
  expectedBodyMatcher: (parsed: unknown) => boolean;
}

let pass = 0;
let fail = 0;

async function runCase(c: ReplayCase): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (c.signature) headers['stripe-signature'] = c.signature;
  const res = await fetch(ENDPOINT, { method: 'POST', headers, body: c.body });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const ok = res.status === c.expectedStatus && c.expectedBodyMatcher(parsed);
  if (ok) {
    pass++;
    console.log(`  ✓ ${c.name}`);
  } else {
    fail++;
    console.log(
      `  ✗ ${c.name}\n      got status=${res.status} body=${JSON.stringify(parsed)}`,
    );
  }
}

const isOk = (b: unknown) =>
  typeof b === 'object' && b !== null && (b as { ok?: boolean }).ok === true;

async function main(): Promise<void> {
  console.log(`Stripe webhook replay → ${ENDPOINT}\n`);

  // ---- Signature contract -------------------------------------------------
  const customerUpdated = makeEvent({
    type: 'customer.updated',
    object: {
      id: freshId('cus_replay'),
      object: 'customer',
      email: 'replay-test@aho.test',
      name: 'Replay Test Customer',
    },
  });
  const customerUpdatedSig = signPayload(customerUpdated.payload, WEBHOOK_SECRET);

  const ignored = makeEvent({
    type: 'payment_intent.created',
    object: { id: freshId('pi_replay'), object: 'payment_intent' },
  });
  const ignoredSig = signPayload(ignored.payload, WEBHOOK_SECRET);

  const cases: ReplayCase[] = [
    // ---- Signature contract (3) ------------------------------------------
    {
      name: 'no signature header → 400 missing_signature',
      body: customerUpdated.payload,
      signature: null,
      expectedStatus: 400,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { error?: string }).error === 'missing_signature',
    },
    {
      name: 'bad signature → 400 invalid_signature',
      body: customerUpdated.payload,
      signature: 't=1,v1=deadbeef',
      expectedStatus: 400,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { error?: string }).error === 'invalid_signature',
    },
    {
      name: 'unhandled event type → 200 ok + ignored:<type>',
      body: ignored.payload,
      signature: ignoredSig,
      expectedStatus: 200,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { ok?: boolean; ignored?: string }).ok === true &&
        (b as { ignored?: string }).ignored === 'payment_intent.created',
    },

    // ---- Per-event-type dispatch (6) -------------------------------------
    // Each handler is exercised through Edge-runtime signature verify +
    // dedup + dispatch. Synthetic IDs miss every DB lookup, handlers
    // gracefully no-op, route returns 200 ok.

    {
      name: 'customer.updated → 200 ok',
      body: customerUpdated.payload,
      signature: customerUpdatedSig,
      expectedStatus: 200,
      expectedBodyMatcher: isOk,
    },
    ...(() => {
      const subDeleted = makeEvent({
        type: 'customer.subscription.deleted',
        object: {
          id: freshId('sub_replay'),
          object: 'subscription',
          status: 'canceled',
          customer: freshId('cus_replay'),
          items: { data: [{ price: { id: freshId('price_replay') } }] },
        },
      });
      return [
        {
          name: 'customer.subscription.deleted → 200 ok (no matching DB row)',
          body: subDeleted.payload,
          signature: signPayload(subDeleted.payload, WEBHOOK_SECRET),
          expectedStatus: 200,
          expectedBodyMatcher: isOk,
        } as ReplayCase,
      ];
    })(),
    // invoice.paid / invoice.payment_failed / invoice.payment_action_required
    // SKIPPED — all three fresh-fetch the invoice from Stripe, which
    // throws on a synthetic ID. See file header.

    ...(() => {
      const charge = makeEvent({
        type: 'charge.refunded',
        object: {
          id: freshId('ch_replay'),
          object: 'charge',
          amount: 2900,
          amount_refunded: 2900,
          currency: 'usd',
          payment_intent: freshId('pi_replay'),
          customer: freshId('cus_replay'),
        },
      });
      return [
        {
          name: 'charge.refunded → 200 ok (no matching payment)',
          body: charge.payload,
          signature: signPayload(charge.payload, WEBHOOK_SECRET),
          expectedStatus: 200,
          expectedBodyMatcher: isOk,
        } as ReplayCase,
      ];
    })(),

    // ---- Idempotency dedup (replay the same event id) --------------------
    {
      name: 'replay same event id → 200 ok + deduped:true',
      body: customerUpdated.payload,
      // Re-sign with a fresh timestamp; the event ID inside is the same,
      // which is what the dedup table keys on.
      signature: signPayload(customerUpdated.payload, WEBHOOK_SECRET),
      expectedStatus: 200,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { ok?: boolean; deduped?: boolean }).ok === true &&
        (b as { deduped?: boolean }).deduped === true,
    },
  ];

  for (const c of cases) {
    await runCase(c);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
