import { emailLayout, escapeHtml } from './_layout';

interface Args {
  recipientName: string | null;
  hostedInvoiceUrl: string;
  amount: string;
  locale: 'en' | 'es';
}

interface Rendered {
  subject: string;
  html: string;
}

/**
 * "Action required" email triggered by Stripe's `invoice.payment_action_required`
 * event (typically a 3DS challenge). Tight, single-CTA — the customer needs
 * to click through to Stripe's hosted invoice URL and complete
 * authentication or the payment will fail.
 */
export function renderPaymentActionRequiredEmail(args: Args): Rendered {
  const isEs = args.locale === 'es';
  const subject = isEs
    ? `Acción requerida para tu pago de ${args.amount}`
    : `Action required for your ${args.amount} payment`;

  const greeting = isEs
    ? `Hola${args.recipientName ? ' ' + args.recipientName : ''},`
    : `Hi${args.recipientName ? ' ' + args.recipientName : ''},`;

  const intro = isEs
    ? `Tu banco solicita una verificación adicional para completar el pago de tu suscripción de AHO.`
    : `Your bank is asking for additional verification to complete your AHO subscription payment.`;

  const ctaText = isEs ? 'Completar la verificación' : 'Complete verification';

  const warning = isEs
    ? 'Si no completas este paso, tu suscripción podría suspenderse.'
    : `If you don't complete this step, your subscription may be paused.`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 16px;color:#52525b;">${intro}</p>
    <p style="margin:0 0 24px;">
      <a href="${escapeHtml(args.hostedInvoiceUrl)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">${ctaText}</a>
    </p>
    <p style="margin:0;color:#71717a;font-size:13px;">${warning}</p>`;

  const html = emailLayout({
    preheader: isEs
      ? 'Verifica tu pago para mantener tu suscripción activa.'
      : 'Verify your payment to keep your subscription active.',
    bodyHtml,
  });

  return { subject, html };
}
