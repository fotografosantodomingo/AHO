/**
 * Minimal email-safe HTML wrapper. Inline styles, table-based layout, no
 * external CSS — works across Gmail / Outlook / Apple Mail. No web fonts;
 * fall back to system fonts.
 *
 * Designed for short transactional emails (lead notification, welcome).
 * For multi-template flows down the road, consider migrating to React Email
 * components — but keep this wrapper as the fallback for environments where
 * RSC/JSX is overkill.
 */

interface LayoutArgs {
  preheader?: string;
  bodyHtml: string;
  footer?: string;
}

const STYLES = {
  body: 'background:#f4f4f5;margin:0;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#18181b;',
  card: 'max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;',
  inner: 'padding:32px 24px;line-height:1.5;font-size:15px;',
  footer:
    'padding:16px 24px;font-size:12px;color:#71717a;border-top:1px solid #e4e4e7;background:#fafafa;',
  brand:
    'font-weight:600;font-size:18px;letter-spacing:-0.01em;color:#18181b;text-decoration:none;',
};

export function emailLayout({ preheader, bodyHtml, footer }: LayoutArgs): string {
  const preheaderHtml = preheader
    ? `<div style="display:none;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
        preheader,
      )}</div>`
    : '';
  const footerHtml =
    footer ??
    '<p style="margin:0;">AHO · advertisehomes.online · You are receiving this because of activity on your AHO account.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>AHO</title>
  </head>
  <body style="${STYLES.body}">
    ${preheaderHtml}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${STYLES.card}">
            <tr>
              <td style="${STYLES.inner}">
                <a href="https://advertisehomes.online" style="${STYLES.brand}">AHO</a>
                <div style="margin-top:24px;">${bodyHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="${STYLES.footer}">${footerHtml}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
