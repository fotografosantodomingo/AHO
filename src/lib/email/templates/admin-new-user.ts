import { COLORS, buttonPrimary, emailLayout, escapeHtml } from './_layout';

interface AdminNewUserArgs {
  /** The newly-signed-up user's email. */
  userEmail: string;
  /** Locale they signed up in (en | es). */
  locale: 'en' | 'es';
  /** Whether they ticked the marketing-opt-in checkbox at signup. */
  marketingOptIn: boolean;
  /** ISO timestamp of signup (server clock at confirmation time). */
  signedUpAt: string;
  /** Admin URL where the platform's user list lives. */
  adminUsersUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Internal admin notification fired on every signup confirmation.
 * English-only — admins are us, not localized.
 */
export function renderAdminNewUserEmail(args: AdminNewUserArgs): RenderedEmail {
  const subject = `[AHO] New user signed up — ${args.userEmail}`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">New user signed up</h1>
    <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
      A new account just confirmed their email address on AHO.
    </p>
    <table cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};">Email</td>
        <td style="padding:6px 0;color:${COLORS.ink};font-weight:600;">${escapeHtml(args.userEmail)}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};">Signup locale</td>
        <td style="padding:6px 0;color:${COLORS.ink};">${args.locale.toUpperCase()}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};">Marketing opt-in</td>
        <td style="padding:6px 0;color:${COLORS.ink};">${args.marketingOptIn ? 'Yes' : 'No'}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:${COLORS.helper};">Confirmed at</td>
        <td style="padding:6px 0;color:${COLORS.ink};">${escapeHtml(args.signedUpAt)}</td>
      </tr>
    </table>
    ${buttonPrimary(escapeHtml(args.adminUsersUrl), 'View in /admin/users')}`;

  const html = emailLayout({
    preheader: `New AHO user: ${args.userEmail}`,
    bodyHtml,
  });

  return { subject, html };
}
