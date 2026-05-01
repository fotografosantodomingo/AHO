import { COLORS, buttonPrimary, emailLayout, escapeHtml } from './_layout';

interface AdminPaymentReceivedArgs {
  /** ISO 4217 + integer cents formatted by the caller. */
  amountLabel: string;
  /** Stripe invoice id (in_xxx) for cross-reference. */
  invoiceId: string;
  /** Subscriber's customer email (from Stripe). */
  customerEmail: string;
  /** Org / agent name attached to the subscription, when known. */
  orgName: string | null;
  /** Plan id (`aho_agent_monthly`, etc.) — useful for routing. */
  planId: string | null;
  /** Stripe Dashboard URL for the invoice. */
  dashboardUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Admin notification fired from the `invoice.paid` webhook handler.
 * One per successful subscription billing event.
 *
 * Always English (admin surface).
 */
export function renderAdminPaymentReceivedEmail(
  args: AdminPaymentReceivedArgs,
): RenderedEmail {
  const subject = `[AHO Admin] Payment received — ${args.amountLabel}`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">Payment received</h1>
    <p style="margin:0 0 16px;color:${COLORS.inkMuted};">A subscription payment cleared on Stripe. Quick details:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;">
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Amount</td><td style="padding:6px 0;font-size:13px;font-weight:700;color:${COLORS.brand};">${escapeHtml(args.amountLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Customer</td><td style="padding:6px 0;font-size:13px;color:${COLORS.ink};">${escapeHtml(args.customerEmail)}</td></tr>
      ${
        args.orgName
          ? `<tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Org</td><td style="padding:6px 0;font-size:13px;color:${COLORS.ink};">${escapeHtml(args.orgName)}</td></tr>`
          : ''
      }
      ${
        args.planId
          ? `<tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Plan</td><td style="padding:6px 0;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${COLORS.ink};">${escapeHtml(args.planId)}</td></tr>`
          : ''
      }
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Invoice</td><td style="padding:6px 0;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${COLORS.helper};">${escapeHtml(args.invoiceId)}</td></tr>
    </table>

    <div>${buttonPrimary(escapeHtml(args.dashboardUrl), 'View in Stripe')}</div>`;

  const html = emailLayout({
    preheader: `Payment received — ${args.amountLabel}`,
    bodyHtml,
    footer:
      'You are receiving this because you are an AHO platform admin. Manage notification settings in your profile.',
  });

  return { subject, html };
}
