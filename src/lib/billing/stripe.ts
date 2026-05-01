import 'server-only';
import Stripe from 'stripe';
import { serverEnv } from '@/lib/env';

/**
 * Lazy Stripe client. Stripe SDK is heavy; cache once per cold start.
 *
 * Timeout: 4000 ms. Stripe webhook handlers must respond within ~10s
 * total, and one slow `subscriptions.retrieve` call burns the budget
 * if Stripe's API is degraded. 4s gives enough headroom for normal
 * latency + retry + DB writes inside the same handler. Stripe SDK's
 * default is 80s — way too long for an Edge webhook context.
 *
 * The webhook signature verification uses `stripe.webhooks.constructEvent()`
 * which is exposed as `verifyWebhookEvent()` below — separate from the API
 * client because constructEvent is a static-ish helper but wants the secret.
 */

const STRIPE_API_TIMEOUT_MS = 4000;

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set.');
  }
  cachedClient = new Stripe(env.STRIPE_SECRET_KEY, {
    timeout: STRIPE_API_TIMEOUT_MS,
  });
  return cachedClient;
}

/**
 * Verify a webhook payload's signature; throws on mismatch.
 *
 * Uses `constructEventAsync` (Web Crypto / SubtleCrypto-backed) instead of
 * the sync `constructEvent`. The deployed runtime is Cloudflare Pages Edge,
 * where the sync path silently mis-verifies — every signed event comes back
 * as "invalid_signature". Stripe's Node SDK documents this: sync uses
 * Node's `crypto` module, async uses Web Crypto. Edge has the latter.
 */
export async function verifyWebhookEvent(args: {
  rawBody: string;
  signature: string;
}): Promise<Stripe.Event> {
  const env = serverEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  }
  const client = getStripeClient();
  return client.webhooks.constructEventAsync(
    args.rawBody,
    args.signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
}

/** Test seam — reset the cached client between unit-test runs. */
export function __resetStripeClientForTests() {
  cachedClient = null;
}
