import 'server-only';
import type Stripe from 'stripe';

/**
 * Handler for `customer.updated`.
 *
 * Per HANDOFF §7.4, this should sync billing email/address. v1 doesn't
 * display billing address anywhere in the agent dashboard (Stripe Customer
 * Portal handles that surface), and the customer ID is the stable join key
 * — emails change on Stripe's side without breaking our links. So this is
 * effectively a no-op for v1, kept in the dispatch table so the event is
 * documented as "received and acknowledged" rather than "ignored as
 * unhandled" (which produces a different log line on the route side).
 *
 * If we later display billing-email or billing-address in the agent
 * dashboard, this handler grows to keep them in sync.
 */
export async function handleCustomerUpdated(event: Stripe.Event): Promise<void> {
  const customer = event.data.object as Stripe.Customer;
  console.log(
    '[customer.updated] received',
    customer.id,
    'email=',
    customer.email,
    'name=',
    customer.name,
  );
}
