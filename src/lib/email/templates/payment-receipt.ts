import { COLORS, buttonPrimary, emailLayout, escapeHtml } from './_layout';

interface PaymentReceiptArgs {
  /** Customer-facing display name when known (preferred over email in
   *  the greeting). Falls back to `there` when null/empty. */
  customerName: string | null;
  /** Localized amount string, e.g. "$29.00". Caller formats. */
  amountLabel: string;
  /** Plan name as we want to show it ("Agent Monthly" / "Pro Automation
   *  Annual" / …). Caller resolves from `plan_id`. */
  planLabel: string;
  /** ISO date of next renewal — caller formats. */
  nextRenewalDate: string;
  /** Stripe-hosted invoice PDF URL. We DON'T attach a PDF; Stripe's
   *  hosted page is the canonical, signature-friendly artifact + always
   *  reflects the latest invoice state. */
  hostedInvoiceUrl: string | null;
  /** Internal billing dashboard (their AHO account billing portal). */
  billingPortalUrl: string;
  /** True when the user is on a MONTHLY plan → upsell to annual is
   *  relevant. False on annual / one-off → no upsell footer. */
  isOnMonthly: boolean;
  /** Pre-filled upgrade-to-annual checkout URL. When the user is in
   *  the 3-day welcome window, the caller appends ?welcome=1 which
   *  /api/billing/checkout-session resolves to the WELCOME5 coupon. */
  upgradeUrl: string;
  /** True when this email lands within 3 days of the customer's first
   *  paid subscription → show the welcome-discount line in the upsell.
   *  False outside the window → upsell still shown (2 months free is
   *  always-on) but without the extra-5%-off line. */
  inWelcomeWindow: boolean;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Customer-facing payment receipt fired from the `invoice.paid` webhook
 * handler after the existing admin notification. One per successful
 * subscription billing event. English (i18n on transactional emails
 * is deferred — see DECISIONS.md, "transactional emails English-only
 * for v1").
 *
 * Sections:
 *   1. Receipt — amount, plan, next renewal, hosted-invoice link
 *   2. Upsell (monthly subscribers only) — "Switch to annual" CTA with
 *      the always-on "2 months free" framing PLUS a 5% welcome bonus
 *      when within 3 days of first payment.
 *
 * The hosted-invoice link is the customer's record of payment for
 * accounting / tax. They can re-download / print / share without
 * needing an AHO login.
 */
export function renderPaymentReceiptEmail(args: PaymentReceiptArgs): RenderedEmail {
  const greeting = args.customerName?.trim()
    ? `Hi ${escapeHtml(args.customerName.trim())},`
    : 'Hi there,';

  const subject = `Receipt for your AHO payment — ${args.amountLabel}`;

  const receiptRows = [
    ['Amount paid', args.amountLabel, true],
    ['Plan', args.planLabel, false],
    ['Next renewal', args.nextRenewalDate, false],
  ];
  const receiptTable = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;">
      ${receiptRows
        .map(
          ([label, value, isAmount]) => `
        <tr>
          <td style="padding:8px 0;color:${COLORS.helper};font-size:13px;width:40%;">${escapeHtml(String(label))}</td>
          <td style="padding:8px 0;font-size:14px;${isAmount ? `font-weight:700;color:${COLORS.brand};` : `color:${COLORS.ink};`}">${escapeHtml(String(value))}</td>
        </tr>`,
        )
        .join('')}
    </table>`;

  const invoiceBlock = args.hostedInvoiceUrl
    ? `<p style="margin:0 0 24px;color:${COLORS.inkMuted};font-size:14px;">
         Need the official invoice for accounting? Download or share it directly from
         <a href="${escapeHtml(args.hostedInvoiceUrl)}" style="color:${COLORS.brand};font-weight:600;text-decoration:none;">your Stripe-hosted invoice</a>.
       </p>`
    : '';

  const billingButton = buttonPrimary(
    escapeHtml(args.billingPortalUrl),
    'Manage subscription',
  );

  // ----- Upsell block (monthly only) -----
  const upsellBlock = args.isOnMonthly
    ? `
    <div style="margin:32px 0 0;padding:24px;border-radius:12px;border:1px solid ${COLORS.brand}22;background:${COLORS.brand}08;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.brand};">
        Save more on annual
      </p>
      <h2 style="margin:0 0 12px;font-size:18px;font-weight:700;color:${COLORS.ink};">
        Switch to annual and get 2 months free
      </h2>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};font-size:14px;">
        Agents on annual billing pay for 10 months instead of 12. Same features,
        same flexibility — you can cancel anytime and we'll prorate the refund.
      </p>
      ${
        args.inWelcomeWindow
          ? `<p style="margin:0 0 16px;padding:10px 12px;border-radius:8px;background:${COLORS.brand}15;color:${COLORS.brand};font-size:13px;font-weight:600;">
               🎁 Welcome offer — upgrade within 3 days and get an EXTRA 5% off on top of the 2-months-free saving (code WELCOME5 applied automatically at checkout).
             </p>`
          : ''
      }
      <div>${buttonPrimary(escapeHtml(args.upgradeUrl), 'Upgrade to annual')}</div>
      <p style="margin:14px 0 0;color:${COLORS.helper};font-size:12px;">
        Not ready? You can also switch from your
        <a href="${escapeHtml(args.billingPortalUrl)}" style="color:${COLORS.helper};text-decoration:underline;">billing portal</a> anytime.
      </p>
    </div>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">Thanks for your payment</h1>
    <p style="margin:0 0 20px;color:${COLORS.inkMuted};font-size:14px;">${greeting}</p>
    <p style="margin:0 0 24px;color:${COLORS.inkMuted};font-size:14px;">
      Your AHO subscription is active and renewing on schedule. Here's the receipt
      for this billing period:
    </p>

    ${receiptTable}
    ${invoiceBlock}

    <div>${billingButton}</div>
    ${upsellBlock}`;

  const html = emailLayout({
    preheader: `Receipt for your AHO payment — ${args.amountLabel}`,
    bodyHtml,
    footer:
      'You are receiving this because you have an active AHO subscription. Manage your billing and email preferences from your account dashboard.',
  });

  return { subject, html };
}
