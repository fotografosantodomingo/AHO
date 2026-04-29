import 'server-only';
import Stripe from 'stripe';
import { serverEnv } from '@/lib/env';

/**
 * Lazy Stripe client. Stripe SDK is heavy; cache once per cold start.
 *
 * The webhook signature verification uses `stripe.webhooks.constructEvent()`
 * which is exposed as `webhookEventFromBody()` below — separate from the API
 * client because constructEvent is a static-ish helper but wants the secret.
 */

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not set.');
  }
  cachedClient = new Stripe(env.STRIPE_SECRET_KEY);
  return cachedClient;
}

/** Verify a webhook payload's signature; throws on mismatch. */
export function verifyWebhookEvent(args: {
  rawBody: string;
  signature: string;
}): Stripe.Event {
  const env = serverEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  }
  const client = getStripeClient();
  return client.webhooks.constructEvent(
    args.rawBody,
    args.signature,
    env.STRIPE_WEBHOOK_SECRET,
  );
}

/** Test seam — reset the cached client between unit-test runs. */
export function __resetStripeClientForTests() {
  cachedClient = null;
}
