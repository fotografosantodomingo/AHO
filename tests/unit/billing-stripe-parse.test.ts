import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import {
  invoiceSubscriptionId,
  paymentIntentIdFromInvoice,
  periodFromSubscription,
} from '@/lib/billing/handlers/_helpers';

/**
 * Cross-version Stripe API parsing — these helpers were extracted from the
 * webhook handlers because the Stripe SDK has moved fields between
 * Subscription-level and SubscriptionItem-level / Invoice-level and
 * line-item-level across API versions. A bug in the parse logic shows up
 * as "no rows updated" in production with no error — exactly the kind of
 * silent failure pre-live testing should catch.
 *
 * The fixtures here are minimal subsets cast through `unknown as` to fit
 * the SDK type — vitest doesn't run Stripe, so we don't need a complete
 * Subscription / Invoice shape.
 */

function asSub(input: object): Stripe.Subscription {
  return input as unknown as Stripe.Subscription;
}

function asInvoice(input: object): Stripe.Invoice {
  return input as unknown as Stripe.Invoice;
}

describe('periodFromSubscription', () => {
  it('reads from item-level fields (newer API)', () => {
    const sub = asSub({
      id: 'sub_123',
      items: {
        data: [
          {
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
            price: { id: 'price_x' },
          },
        ],
      },
    });
    const { start, end } = periodFromSubscription(sub);
    expect(start).toBe(1_700_000_000);
    expect(end).toBe(1_702_592_000);
  });

  it('falls back to subscription-level fields when item-level is missing (older API)', () => {
    const sub = asSub({
      id: 'sub_456',
      current_period_start: 1_710_000_000,
      current_period_end: 1_712_592_000,
      items: {
        data: [{ price: { id: 'price_y' } }],
      },
    });
    const { start, end } = periodFromSubscription(sub);
    expect(start).toBe(1_710_000_000);
    expect(end).toBe(1_712_592_000);
  });

  it('prefers item-level over subscription-level when both are present', () => {
    const sub = asSub({
      id: 'sub_both',
      current_period_start: 9_999_999_999, // ignored
      current_period_end: 9_999_999_999,
      items: {
        data: [
          {
            current_period_start: 1_700_000_000,
            current_period_end: 1_702_592_000,
            price: { id: 'price_z' },
          },
        ],
      },
    });
    const { start, end } = periodFromSubscription(sub);
    expect(start).toBe(1_700_000_000);
    expect(end).toBe(1_702_592_000);
  });

  it('throws a descriptive error when neither location has the period', () => {
    const sub = asSub({
      id: 'sub_broken',
      items: { data: [{ price: { id: 'price_a' } }] },
    });
    expect(() => periodFromSubscription(sub)).toThrow(/sub_broken/);
    expect(() => periodFromSubscription(sub)).toThrow(
      /current_period_start\/end/,
    );
  });
});

describe('invoiceSubscriptionId', () => {
  it('reads from invoice.subscription as a plain string (older API)', () => {
    const inv = asInvoice({ id: 'in_1', subscription: 'sub_abc' });
    expect(invoiceSubscriptionId(inv)).toBe('sub_abc');
  });

  it('reads from invoice.subscription as an expanded object', () => {
    const inv = asInvoice({ id: 'in_2', subscription: { id: 'sub_def' } });
    expect(invoiceSubscriptionId(inv)).toBe('sub_def');
  });

  it('reads from line-item parent.subscription_item_details (newer API)', () => {
    const inv = asInvoice({
      id: 'in_3',
      lines: {
        data: [
          {
            parent: {
              subscription_item_details: { subscription: 'sub_new_api' },
            },
          },
        ],
      },
    });
    expect(invoiceSubscriptionId(inv)).toBe('sub_new_api');
  });

  it('returns null for one-off invoices (no subscription anywhere)', () => {
    const inv = asInvoice({ id: 'in_4', lines: { data: [] } });
    expect(invoiceSubscriptionId(inv)).toBeNull();
  });

  it('returns null when subscription is explicitly null', () => {
    const inv = asInvoice({
      id: 'in_5',
      subscription: null,
      lines: { data: [{ parent: {} }] },
    });
    expect(invoiceSubscriptionId(inv)).toBeNull();
  });

  it('prefers older top-level subscription over newer line-item shape when both are set (defensive)', () => {
    // If a future Stripe version sends BOTH (during a deprecation window),
    // we lock in older-shape priority. Either is valid; consistency matters.
    const inv = asInvoice({
      id: 'in_6',
      subscription: 'sub_old_shape',
      lines: {
        data: [
          {
            parent: {
              subscription_item_details: { subscription: 'sub_new_shape' },
            },
          },
        ],
      },
    });
    expect(invoiceSubscriptionId(inv)).toBe('sub_old_shape');
  });
});

describe('paymentIntentIdFromInvoice', () => {
  it('reads from invoice.payment_intent as a plain string', () => {
    const inv = asInvoice({ id: 'in_p1', payment_intent: 'pi_abc' });
    expect(paymentIntentIdFromInvoice(inv)).toBe('pi_abc');
  });

  it('reads from invoice.payment_intent as an expanded object', () => {
    const inv = asInvoice({ id: 'in_p2', payment_intent: { id: 'pi_def' } });
    expect(paymentIntentIdFromInvoice(inv)).toBe('pi_def');
  });

  it('returns null when payment_intent is missing entirely', () => {
    const inv = asInvoice({ id: 'in_p3' });
    expect(paymentIntentIdFromInvoice(inv)).toBeNull();
  });

  it('returns null when payment_intent is explicitly null', () => {
    const inv = asInvoice({ id: 'in_p4', payment_intent: null });
    expect(paymentIntentIdFromInvoice(inv)).toBeNull();
  });
});
