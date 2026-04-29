import 'server-only';
import type Stripe from 'stripe';
import { getStripeClient } from '../stripe';
import { updateSubscriptionFromStripe } from './_helpers';

/**
 * Handler for `customer.subscription.updated`.
 *
 * Per `docs/DECISIONS.md` "customer.subscription.updated handler: fresh-fetch
 * from Stripe" — we treat the event payload purely as a trigger and ID source.
 * The authoritative state comes from `stripe.subscriptions.retrieve(id)`,
 * which removes the out-of-order delivery problem entirely (Stripe doesn't
 * guarantee event order; an older event arriving after a newer one with naïve
 * last-write-wins corrupts state).
 *
 * What this fires for, in practice:
 *   - Trial-to-active transition (status flips, period reset)
 *   - Plan change (new plan_id, prorated period)
 *   - cancel_at_period_end set or cleared
 *   - Period rollover after a successful renewal
 *   - Status flips from past_due → active (after dunning recovery) or past_due → unpaid (dunning give-up)
 *
 * If our DB has no matching subscription row (rare — would mean
 * `checkout.session.completed` hasn't been processed yet), we log and skip.
 * The next event in the cascade typically catches up; if not, the subscription
 * sits in a missing-row state until manual reconciliation.
 */
export async function handleCustomerSubscriptionUpdated(
  event: Stripe.Event,
): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;
  if (!sub.id) {
    throw new Error('subscription.updated event has no subscription id');
  }

  const stripe = getStripeClient();
  const fresh = await stripe.subscriptions.retrieve(sub.id);

  const result = await updateSubscriptionFromStripe(fresh);
  if (!result.orgId) {
    console.warn(
      `[customer.subscription.updated] no DB row for subscription ${sub.id}; skipped. ` +
        `Likely a checkout.session.completed event still in flight.`,
    );
  }
}
