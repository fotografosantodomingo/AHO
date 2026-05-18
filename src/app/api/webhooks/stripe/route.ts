import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { verifyWebhookEvent } from '@/lib/billing/stripe';
import { markEventProcessed } from '@/lib/billing/webhooks';
import { handleCheckoutSessionCompleted } from '@/lib/billing/handlers/checkout-session-completed';
import { handleCustomerSubscriptionUpdated } from '@/lib/billing/handlers/customer-subscription-updated';
import { handleCustomerSubscriptionDeleted } from '@/lib/billing/handlers/customer-subscription-deleted';
import { handleInvoicePaid } from '@/lib/billing/handlers/invoice-paid';
import { handleInvoicePaymentFailed } from '@/lib/billing/handlers/invoice-payment-failed';
import { handleInvoicePaymentActionRequired } from '@/lib/billing/handlers/invoice-payment-action-required';
import { handleCustomerUpdated } from '@/lib/billing/handlers/customer-updated';
import { handleChargeRefunded } from '@/lib/billing/handlers/charge-refunded';
import { handlePrivateListingPurchase } from '@/lib/billing/handlers/private-listing-purchase';
import { handlePrivateListingRefund } from '@/lib/billing/handlers/private-listing-refund';

export const runtime = 'edge';

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook entry point. Per CLAUDE.md hard rule #3:
 *   - Verify the signature before parsing the body.
 *   - Be idempotent (dedup via `stripe_events_processed`).
 *   - The DB is a cache of Stripe state; events are the source of truth.
 *
 * Excluded from auth middleware via the matcher (`api/webhooks` is in the
 * negative-lookahead in `src/middleware.ts`).
 *
 * Stripe expects a 2xx response within ~10s; failures cause retries with
 * exponential backoff. We dispatch to handlers synchronously here — when
 * we add expensive handlers (auto-blog generation, social fan-out from
 * checkout) those will enqueue to Cloudflare Queues and return 200 fast.
 */

type EventHandler = (event: Stripe.Event) => Promise<void>;

const HANDLERS: Record<string, EventHandler> = {
  'checkout.session.completed': dispatchCheckoutSessionCompleted,
  'customer.subscription.updated': handleCustomerSubscriptionUpdated,
  'customer.subscription.deleted': handleCustomerSubscriptionDeleted,
  'customer.updated': handleCustomerUpdated,
  'invoice.paid': handleInvoicePaid,
  'invoice.payment_failed': handleInvoicePaymentFailed,
  'invoice.payment_action_required': handleInvoicePaymentActionRequired,
  'charge.refunded': dispatchChargeRefunded,

  // -------------------------------------------------------------------------
  // INTENTIONALLY NOT HANDLED — do NOT add without an explicit DECISIONS entry
  // -------------------------------------------------------------------------
  //
  // 'invoice.payment_succeeded' — see docs/DECISIONS.md "invoice.paid for
  // fulfillment; invoice.payment_succeeded explicitly NOT handled". Both events
  // fire for the same transition; handling both double-extends the subscription.
  // We use `invoice.paid` exclusively because it fires after Stripe has fully
  // reconciled the invoice. Adding this handler is a foot-gun.
  //
  // -------------------------------------------------------------------------
};

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  // Stripe signs the raw bytes — read .text() not .json() or signature fails.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await verifyWebhookEvent({ rawBody, signature });
  } catch (e) {
    console.error('[stripe webhook] signature verification failed', e);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  // Idempotency dedup — if we already processed this event, return 200 OK.
  let firstSeen: boolean;
  try {
    firstSeen = await markEventProcessed(event);
  } catch (e) {
    console.error('[stripe webhook] dedup table failed', e);
    // Return 5xx so Stripe retries.
    return NextResponse.json({ error: 'dedup_failed' }, { status: 500 });
  }
  if (!firstSeen) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  const handler = HANDLERS[event.type];
  if (!handler) {
    // Stripe doesn't retry on 2xx for unhandled events; that's fine — we
    // don't want to act on events we don't know about.
    return NextResponse.json({ ok: true, ignored: event.type });
  }

  try {
    await handler(event);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[stripe webhook] handler ${event.type} failed`, e);
    // Returning 5xx triggers Stripe to retry. The dedup row was inserted
    // BEFORE the handler ran, so a retry would see the event as already
    // processed and skip it. Roll back the dedup so retries actually retry.
    await rollbackDedup(event.id);
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }
}

/**
 * Dispatch `checkout.session.completed` to the right handler based on
 * the session's `mode` + `metadata.aho_purpose`.
 *
 *   mode='subscription'                           → existing subscription handler
 *   mode='payment' + aho_purpose='private_listing'→ private-listing handler
 *   anything else                                  → log + ignore
 *
 * Per docs/SELL_FUNNEL_PLAN.md Track D §3 — the two flows share an event
 * type but write to entirely different tables, so we route at the
 * webhook entry rather than branch inside one handler.
 */
async function dispatchCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode === 'subscription') {
    return handleCheckoutSessionCompleted(event);
  }
  if (
    session.mode === 'payment' &&
    session.metadata?.aho_purpose === 'private_listing'
  ) {
    return handlePrivateListingPurchase(event);
  }
  console.warn(
    '[stripe webhook] unrecognized checkout.session.completed mode/purpose',
    {
      sessionId: session.id,
      mode: session.mode,
      aho_purpose: session.metadata?.aho_purpose,
    },
  );
}

/**
 * Dispatch `charge.refunded` to BOTH the subscription `payments` handler
 * AND the private-listing refund handler. Each handler returns early if
 * the charge does not match its table — they are mutually exclusive in
 * practice (a charge is either a subscription invoice or a one-time
 * listing payment) but the dispatch is defensive: we ALWAYS try both so
 * a future product can't go un-handled by accident.
 */
async function dispatchChargeRefunded(event: Stripe.Event): Promise<void> {
  await handlePrivateListingRefund(event);
  await handleChargeRefunded(event);
}

/**
 * On handler failure, remove the dedup row so the next Stripe retry runs
 * the handler again. (Without this, a transient failure would be treated
 * as a permanent skip.)
 */
async function rollbackDedup(eventId: string): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const supabase = createAdminClient();
    await supabase.from('stripe_events_processed').delete().eq('stripe_event_id', eventId);
  } catch (e) {
    console.error('[stripe webhook] dedup rollback failed for', eventId, e);
  }
}
