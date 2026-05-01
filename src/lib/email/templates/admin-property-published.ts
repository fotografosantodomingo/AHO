import { COLORS, buttonPrimary, buttonSecondary, emailLayout, escapeHtml } from './_layout';

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
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">New listing published</h1>
    <p style="margin:0 0 16px;color:${COLORS.inkMuted};">An agent just published a new listing on AHO. Quick details:</p>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 24px;">
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Title</td><td style="padding:6px 0;font-size:13px;color:${COLORS.ink};">${escapeHtml(args.title)}</td></tr>
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Location</td><td style="padding:6px 0;font-size:13px;color:${COLORS.ink};">${escapeHtml(args.city)}, ${escapeHtml(args.countryCode)}</td></tr>
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Price</td><td style="padding:6px 0;font-size:13px;color:${COLORS.ink};">${escapeHtml(args.priceLabel)}</td></tr>
      <tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">Agent</td><td style="padding:6px 0;font-size:13px;color:${COLORS.ink};">${escapeHtml(args.agentName)} &lt;${escapeHtml(args.agentEmail)}&gt;</td></tr>
    </table>

    <div>
      ${buttonPrimary(escapeHtml(args.publicUrl), 'View public listing')}
      ${buttonSecondary(escapeHtml(args.adminListingsUrl), 'Open admin')}
    </div>`;

  const html = emailLayout({
    preheader: `New listing — ${args.title} in ${args.city}`,
    bodyHtml,
    footer:
      'You are receiving this because you are an AHO platform admin. Manage notification settings in your profile.',
  });

  return { subject, html };
}
