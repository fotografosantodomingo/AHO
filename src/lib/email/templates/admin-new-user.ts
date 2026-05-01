import { emailLayout, escapeHtml } from './_layout';

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
    <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">New user signed up</h1>
    <p style="margin:0 0 12px;color:#52525b;">
      A new account just confirmed their email address on AHO.
    </p>
    <table cellspacing="0" cellpadding="0" border="0" style="margin:0 0 24px;border-collapse:collapse;font-size:14px;">
      <tr>
        <td style="padding:6px 12px 6px 0;color:#71717a;">Email</td>
        <td style="padding:6px 0;font-weight:500;">${escapeHtml(args.userEmail)}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:#71717a;">Signup locale</td>
        <td style="padding:6px 0;">${args.locale.toUpperCase()}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:#71717a;">Marketing opt-in</td>
        <td style="padding:6px 0;">${args.marketingOptIn ? 'Yes' : 'No'}</td>
      </tr>
      <tr>
        <td style="padding:6px 12px 6px 0;color:#71717a;">Confirmed at</td>
        <td style="padding:6px 0;">${escapeHtml(args.signedUpAt)}</td>
      </tr>
    </table>
    <a href="${escapeHtml(
      args.adminUsersUrl,
    )}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">View in /admin/users</a>`;

  const html = emailLayout({
    preheader: `New AHO user: ${args.userEmail}`,
    bodyHtml,
  });

  return { subject, html };
}
