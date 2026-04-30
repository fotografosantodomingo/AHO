/**
 * Stripe webhook replay test.
 *
 * Hand-rolled probe that exercises the live deployed webhook endpoint at
 * NEXT_PUBLIC_SITE_URL/api/webhooks/stripe — covers the four cross-cutting
 * concerns from CLAUDE.md hard rule #3 + the route's own contract:
 *   1. Reject requests with no signature  → 400 missing_signature
 *   2. Reject requests with bad signature → 400 invalid_signature
 *   3. Accept properly signed events      → 200 ok
 *   4. Dedup re-deliveries of same id     → 200 ok + deduped: true
 *   5. Unknown event types are ignored    → 200 ok + ignored: <type>
 *
 * Per-handler side-effect testing is a separate concern (would require
 * staging DB state per handler). This script proves the dispatch + auth +
 * idempotency layer works end-to-end against the deployed Pages Worker.
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
 * over `${timestamp}.${rawBody}`), so the deployed webhook validates them
 * as if they came from Stripe itself.
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

/**
 * Reproduces Stripe's test-header generator (the JS SDK has
 * `stripe.webhooks.generateTestHeaderString`, but pulling that in requires
 * the heavy SDK; HMAC-SHA256 of `${timestamp}.${payload}` matches the
 * `t=...,v1=...` format the deployed webhook validates against).
 */
function signPayload(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return `t=${timestamp},v1=${sig}`;
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

async function main(): Promise<void> {
  console.log(`Stripe webhook replay → ${ENDPOINT}\n`);

  // Build a minimal `customer.updated` event payload. We pick this event
  // because its handler is a deliberate no-op (just logs), so success
  // doesn't depend on any DB state being present.
  const eventId = `evt_replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const customerUpdatedPayload = JSON.stringify({
    id: eventId,
    object: 'event',
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'customer.updated',
    data: {
      object: {
        id: 'cus_replay_test',
        object: 'customer',
        email: 'replay-test@aho.test',
        name: 'Replay Test Customer',
      },
    },
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  });
  const goodSig = signPayload(customerUpdatedPayload, WEBHOOK_SECRET);

  // Unknown event type — we send a `payment_intent.created` because we
  // don't have a handler for it (intentionally; it appears in the dispatch
  // table's negative space).
  const ignoredEventId = `evt_replay_ignored_${Date.now()}`;
  const ignoredPayload = JSON.stringify({
    id: ignoredEventId,
    object: 'event',
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'payment_intent.created',
    data: { object: { id: 'pi_replay_test', object: 'payment_intent' } },
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
  });
  const ignoredSig = signPayload(ignoredPayload, WEBHOOK_SECRET);

  const cases: ReplayCase[] = [
    {
      name: 'no signature header → 400 missing_signature',
      body: customerUpdatedPayload,
      signature: null,
      expectedStatus: 400,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { error?: string }).error === 'missing_signature',
    },
    {
      name: 'bad signature → 400 invalid_signature',
      body: customerUpdatedPayload,
      signature: 't=1,v1=deadbeef',
      expectedStatus: 400,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { error?: string }).error === 'invalid_signature',
    },
    {
      name: 'good signature, customer.updated event → 200 ok',
      body: customerUpdatedPayload,
      signature: goodSig,
      expectedStatus: 200,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' && b !== null && (b as { ok?: boolean }).ok === true,
    },
    {
      name: 'replay same event id → 200 ok + deduped:true',
      body: customerUpdatedPayload,
      signature: signPayload(customerUpdatedPayload, WEBHOOK_SECRET), // fresh ts, same id
      expectedStatus: 200,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { ok?: boolean; deduped?: boolean }).ok === true &&
        (b as { deduped?: boolean }).deduped === true,
    },
    {
      name: 'unhandled event type → 200 ok + ignored:<type>',
      body: ignoredPayload,
      signature: ignoredSig,
      expectedStatus: 200,
      expectedBodyMatcher: (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as { ok?: boolean; ignored?: string }).ok === true &&
        (b as { ignored?: string }).ignored === 'payment_intent.created',
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
