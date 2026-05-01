import { emailLayout, escapeHtml } from './_layout';

interface AdminPropertyPublishedArgs {
  /** What we display as the listing title in the email. */
  title: string;
  /** City + country for context. */
  city: string;
  countryCode: string;
  /** ISO 4217 + integer cents — formatted by the caller. */
  priceLabel: string;
  /** Agent's full name (or "—" if not set). */
  agentName: string;
  /** Agent's email address (admin uses for follow-up). */
  agentEmail: string;
  /** Public canonical URL for the listing. */
  publicUrl: string;
  /** Admin moderation URL (`/admin` listings tab). */
  adminListingsUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Admin-side notification fired when an agent publishes a listing.
 * Goes to ADMIN_EMAIL (info@advertisehomes.online by default).
 *
 * Always English — admin surface is internal, not localized.
 */
export function renderAdminPropertyPublishedEmail(
  args: AdminPropertyPublishedArgs,
): RenderedEmail {
  const subject = `[AHO Admin] New listing published — ${args.title}`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-0.01em;">New listing published</h1>
    <p style="margin:0 0 12px;color:#52525b;">An agent just published a new listing on AHO. Quick details:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Title</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(args.title)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Location</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(args.city)}, ${escapeHtml(args.countryCode)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Price</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(args.priceLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:#71717a;font-size:13px;">Agent</td><td style="padding:6px 0;font-size:13px;">${escapeHtml(args.agentName)} &lt;${escapeHtml(args.agentEmail)}&gt;</td></tr>
    </table>

    <div>
      <a href="${escapeHtml(args.publicUrl)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;font-size:14px;">View public listing</a>
      <a href="${escapeHtml(args.adminListingsUrl)}" style="display:inline-block;margin-left:8px;padding:10px 18px;border:1px solid #e4e4e7;color:#18181b;text-decoration:none;border-radius:6px;font-size:14px;">Open admin</a>
    </div>`;

  const html = emailLayout({
    preheader: `New listing — ${args.title} in ${args.city}`,
    bodyHtml,
    footer:
      'You are receiving this because you are an AHO platform admin. Manage notification settings in your profile.',
  });

  return { subject, html };
}
