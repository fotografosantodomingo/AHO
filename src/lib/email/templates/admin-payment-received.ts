import { emailLayout, escapeHtml } from './_layout';

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
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-0.01em;">Payment received</h1>
    <p style="margin:0 0 12px;color:#52525b;">A subscription payment cleared on Stripe. Quick details:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Amount</td><td style="padding:6px 0;font-size:13px;font-weight:600;">${escapeHtml(args.amountLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Customer</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(args.customerEmail)}</td></tr>
      ${
        args.orgName
          ? `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Org</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(args.orgName)}</td></tr>`
          : ''
      }
      ${
        args.planId
          ? `<tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Plan</td><td style="padding:6px 0;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(args.planId)}</td></tr>`
          : ''
      }
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Invoice</td><td style="padding:6px 0;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#52525b;">${escapeHtml(args.invoiceId)}</td></tr>
    </table>

    <div>
      <a href="${escapeHtml(args.dashboardUrl)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View in Stripe</a>
    </div>`;

  const html = emailLayout({
    preheader: `Payment received — ${args.amountLabel}`,
    bodyHtml,
    footer:
      'You are receiving this because you are an AHO platform admin. Manage notification settings in your profile.',
  });

  return { subject, html };
}
