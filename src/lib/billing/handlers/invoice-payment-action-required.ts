import 'server-only';
import type Stripe from 'stripe';
import { getStripeClient } from '../stripe';
import { sendEmail } from '@/lib/email/resend';
import { renderPaymentActionRequiredEmail } from '@/lib/email/templates/payment-action-required';
import { formatPrice } from '@/lib/listings/seo';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Handler for `invoice.payment_action_required`.
 *
 * Stripe fires this when an invoice payment needs additional authentication
 * (typically 3DS). The customer needs to click through to the hosted invoice
 * URL and complete the challenge or the payment fails.
 *
 * We notify the customer via email with the hosted-invoice URL. The email
 * is best-effort (no-op if Resend isn't configured).
 *
 * The subscription's status will already be `incomplete` or `past_due`
 * after this event; the regular `customer.subscription.updated` handler
 * keeps our DB row in sync.
 */
export async function handleInvoicePaymentActionRequired(
  event: Stripe.Event,
): Promise<void> {
  const invoiceFromEvent = event.data.object as Stripe.Invoice;
  if (!invoiceFromEvent.id) {
    throw new Error('invoice.payment_action_required event has no invoice id');
  }

  const stripe = getStripeClient();
  const invoice = await stripe.invoices.retrieve(invoiceFromEvent.id);

  const hostedUrl = invoice.hosted_invoice_url;
  if (!hostedUrl) {
    console.warn(
      '[invoice.payment_action_required] no hosted_invoice_url; skipping notification',
      invoice.id,
    );
    return;
  }

  // Resolve recipient email + locale. Prefer the customer object's email
  // (Stripe-canonical); fall back to invoice.customer_email.
  let recipientEmail: string | null = invoice.customer_email ?? null;
  let recipientName: string | null = null;
  let locale: 'en' | 'es' = 'en';

  if (typeof invoice.customer === 'string') {
    try {
      const customer = await stripe.customers.retrieve(invoice.customer);
      if (!customer.deleted) {
        recipientEmail = customer.email ?? recipientEmail;
        recipientName = customer.name ?? null;
      }
    } catch (e) {
      console.warn('[invoice.payment_action_required] customer retrieve failed', e);
    }
  }

  // Look up our profile to pick the agent's preferred locale.
  if (recipientEmail) {
    const supabase = createAdminClient();
    const { data: profile } = await supabase
      .from('profiles')
      .select('preferred_language, full_name')
      .eq('email', recipientEmail)
      .maybeSingle();
    if (profile?.preferred_language === 'es') locale = 'es';
    if (!recipientName) recipientName = profile?.full_name ?? null;
  }

  if (!recipientEmail) {
    console.warn(
      '[invoice.payment_action_required] no recipient email; skipping notification',
      invoice.id,
    );
    return;
  }

  const amount = formatPrice(
    invoice.amount_due ?? 0,
    (invoice.currency ?? 'USD').toUpperCase(),
    locale,
  );
  const { subject, html } = renderPaymentActionRequiredEmail({
    recipientName,
    hostedInvoiceUrl: hostedUrl,
    amount,
    locale,
  });

  await sendEmail({ to: recipientEmail, subject, html });
}
