import { COLORS, buttonPrimary, emailLayout, escapeHtml } from './_layout';

interface FoundingAgentAdminAlertArgs {
  fullName: string;
  email: string;
  whatsapp: string | null;
  city: string;
  countryCode: string;
  countryDisplay: string;
  portfolioUrl: string | null;
  message: string | null;
  applicationId: string;
  appliedAt: string;
  adminUrl: string;
  utmSource: string | null;
  utmCampaign: string | null;
  /** Total applications received so far including this one. */
  applicationCountTotal: number;
  /** Cap on the Founding 50 program — surfaces "X of 50" remaining. */
  applicationCap: number;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Operator alert email — fired when a new Founding 50 application
 * lands. Internal-facing (English only). Includes everything the
 * operator needs to triage + reach out within the 24-48h promise from
 * the applicant-facing welcome.
 *
 * The X-of-50 count is the urgency / momentum signal — operator sees
 * how the pipeline is filling at a glance.
 */
export function renderFoundingAgentAdminAlertEmail(
  args: FoundingAgentAdminAlertArgs,
): RenderedEmail {
  const remaining = Math.max(0, args.applicationCap - args.applicationCountTotal);
  const subject =
    remaining === 0
      ? `[AHO] Founding 50 FULL — ${escapeHtml(args.fullName)} from ${args.city}`
      : `[AHO] Founding 50 #${args.applicationCountTotal} — ${args.fullName} (${args.city}, ${args.countryCode})`;

  const whatsappLink = args.whatsapp
    ? `https://wa.me/${args.whatsapp.replace(/[^0-9+]/g, '')}`
    : null;

  const bodyHtml = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">New Founding 50 application</h1>
    <p style="margin:0 0 20px;color:${COLORS.helper};font-size:14px;">
      <strong style="color:${COLORS.ink};">#${args.applicationCountTotal} of ${args.applicationCap}</strong> · ${remaining} ${remaining === 1 ? 'spot' : 'spots'} remaining
    </p>
    <table cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border-collapse:collapse;font-size:14px;width:100%;">
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">Name</td>
        <td style="padding:6px 0;color:${COLORS.ink};font-weight:600;">${escapeHtml(args.fullName)}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">Email</td>
        <td style="padding:6px 0;color:${COLORS.ink};">
          <a href="mailto:${escapeHtml(args.email)}" style="color:${COLORS.brand};text-decoration:none;">${escapeHtml(args.email)}</a>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">WhatsApp</td>
        <td style="padding:6px 0;color:${COLORS.ink};">
          ${whatsappLink
            ? `<a href="${escapeHtml(whatsappLink)}" style="color:${COLORS.brand};text-decoration:none;">${escapeHtml(args.whatsapp ?? '')}</a> <span style="color:${COLORS.helper};">(click to open)</span>`
            : '<span style="color:' + COLORS.helper + ';">— not provided</span>'}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">Market</td>
        <td style="padding:6px 0;color:${COLORS.ink};">${escapeHtml(args.city)}, ${escapeHtml(args.countryDisplay)} (${escapeHtml(args.countryCode)})</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">Portfolio</td>
        <td style="padding:6px 0;color:${COLORS.ink};">
          ${args.portfolioUrl
            ? `<a href="${escapeHtml(args.portfolioUrl)}" style="color:${COLORS.brand};text-decoration:none;">${escapeHtml(args.portfolioUrl)}</a>`
            : '<span style="color:' + COLORS.helper + ';">— not provided</span>'}
        </td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">Applied at</td>
        <td style="padding:6px 0;color:${COLORS.ink};">${escapeHtml(args.appliedAt)}</td>
      </tr>
      ${args.utmSource || args.utmCampaign
        ? `<tr>
            <td style="padding:6px 12px 6px 0;color:${COLORS.helper};vertical-align:top;">Attribution</td>
            <td style="padding:6px 0;color:${COLORS.ink};font-family:monospace;font-size:12px;">${escapeHtml(args.utmSource ?? '?')} / ${escapeHtml(args.utmCampaign ?? '?')}</td>
          </tr>`
        : ''}
    </table>
    ${args.message
      ? `<div style="margin:0 0 24px;padding:16px;background:${COLORS.bandSoft};border-left:3px solid ${COLORS.brand};border-radius:6px;">
          <p style="margin:0 0 6px;color:${COLORS.helper};font-size:12px;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Their message</p>
          <p style="margin:0;color:${COLORS.ink};white-space:pre-wrap;">${escapeHtml(args.message)}</p>
        </div>`
      : ''}
    ${buttonPrimary(escapeHtml(args.adminUrl), 'Open in /admin/founding-agents')}
    <p style="margin:24px 0 0;color:${COLORS.helper};font-size:13px;line-height:1.5;">
      <strong>Next step:</strong> message them on WhatsApp within 24-48 hours per the welcome-email promise. Mark <em>contacted</em> in the admin view once you do.
    </p>`;

  const html = emailLayout({
    preheader: `${args.fullName} (${args.city}, ${args.countryCode}) — ${args.applicationCountTotal}/${args.applicationCap} spots filled`,
    bodyHtml,
  });

  const text = [
    `New Founding 50 application — #${args.applicationCountTotal} of ${args.applicationCap}`,
    '',
    `Name:       ${args.fullName}`,
    `Email:      ${args.email}`,
    `WhatsApp:   ${args.whatsapp ?? '— not provided'}`,
    `Market:     ${args.city}, ${args.countryDisplay} (${args.countryCode})`,
    `Portfolio:  ${args.portfolioUrl ?? '— not provided'}`,
    `Applied at: ${args.appliedAt}`,
    args.message ? `\nTheir message:\n${args.message}\n` : '',
    `Open in admin: ${args.adminUrl}`,
    '',
    'Next: WhatsApp them within 24-48h. Mark contacted in admin view.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}
