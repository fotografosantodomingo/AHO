/**
 * Email-safe HTML wrapper. Inline styles, table-based layout, no
 * external CSS — works across Gmail / Outlook / Apple Mail. No web
 * fonts; fall back to system sans-serif.
 *
 * DP-2d redesign: AHO emails now share the inspired-by-Starbucks visual
 * language with the website — warm cream canvas, forest-green accent
 * strip at the top of the card, forest-green primary CTA pills, warm
 * brown helper text. Color tokens are kept in the COLORS map below;
 * all templates that compose buttons should reach for `buttonPrimary()`
 * / `buttonSecondary()` rather than inlining their own styles, so the
 * voice stays consistent without per-template drift.
 *
 * Keep this wrapper as the source of truth for transactional email
 * chrome. For multi-template flows down the road, consider migrating
 * to React Email — but the inline-styled HTML approach here is the
 * lowest-friction path that survives every major mail client.
 */

import { FACEBOOK_URL, INSTAGRAM_URL, LINKEDIN_URL } from '@/lib/social-urls';

interface LayoutArgs {
  preheader?: string;
  bodyHtml: string;
  footer?: string;
}

const SITE_URL = 'https://advertisehomes.online';
const SUPPORT_EMAIL = 'info@advertisehomes.online';
const BUSINESS_ADDRESS =
  'AHO · Advertise Homes Online · Santo Domingo, Dominican Republic';

/**
 * Color tokens — DP-2d email palette. Mirrors the site `@theme` tokens
 * (warm cream canvas, forest brand, warm helper). Values inlined since
 * email CSS variables aren't reliably supported.
 */
export const COLORS = {
  canvas: '#f4ede1',           // body bg — warm cream
  card: '#ffffff',             // card surface
  cardBorder: 'rgba(112, 95, 70, 0.18)', // warm tan, low alpha
  ink: '#1a1612',              // primary text — warm near-black
  inkMuted: '#3a342c',         // body copy
  helper: '#5e574d',           // captions, footer
  helperSoft: '#8a7e6c',       // very-quiet text (small print)
  brand: '#1d5a3c',            // forest green — primary CTA, accent
  brandHover: '#236a47',       // pressed state (rarely used in email)
  white: '#ffffff',
  bandSoft: '#ebe1ce',         // muted block bg (quoted content)
} as const;

const STYLES = {
  body: `background:${COLORS.canvas};margin:0;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${COLORS.ink};letter-spacing:-0.01em;`,
  card: `max-width:560px;margin:0 auto;background:${COLORS.card};border:1px solid ${COLORS.cardBorder};border-radius:12px;overflow:hidden;`,
  // Forest-green accent strip at the top of the card. The signature
  // inspired-by move — a quiet 4px band that anchors the AHO identity
  // without shouting. (Email clients render <td height="4"> reliably.)
  accentStrip: `background:${COLORS.brand};line-height:0;font-size:0;height:4px;`,
  inner: `padding:32px 28px;line-height:1.55;font-size:15px;color:${COLORS.inkMuted};`,
  brand: `font-weight:700;font-size:20px;letter-spacing:-0.02em;color:${COLORS.ink};text-decoration:none;`,
  footer: `padding:20px 28px;font-size:12px;color:${COLORS.helper};border-top:1px solid ${COLORS.cardBorder};background:${COLORS.bandSoft};`,
} as const;

/**
 * Forest-green pill primary CTA. Inline-styled for email-client
 * compatibility. Use `buttonPrimary(href, 'Open inbox')` inside a
 * template body.
 */
export function buttonPrimary(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;padding:11px 22px;background:${COLORS.brand};color:${COLORS.white};text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px;letter-spacing:-0.01em;">${escapeHtml(label)}</a>`;
}

/**
 * Bordered cream secondary CTA. Pairs with `buttonPrimary` when a
 * template wants to offer two actions.
 */
export function buttonSecondary(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;margin-left:8px;padding:10px 22px;border:1px solid ${COLORS.cardBorder};color:${COLORS.ink};text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px;letter-spacing:-0.01em;background:${COLORS.card};">${escapeHtml(label)}</a>`;
}

/**
 * Soft cream block — used for quoted content, "what to expect" notes,
 * any "this is set apart from the body copy" surface inside a template.
 */
export function softBlock(innerHtml: string): string {
  return `<div style="margin:20px 0;padding:16px;background:${COLORS.bandSoft};border:1px solid ${COLORS.cardBorder};border-radius:8px;">${innerHtml}</div>`;
}

export function emailLayout({ preheader, bodyHtml, footer }: LayoutArgs): string {
  const preheaderHtml = preheader
    ? `<div style="display:none;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
        preheader,
      )}</div>`
    : '';

  const reasonLine =
    footer ?? 'You are receiving this because of activity on your AHO account.';

  const footerHtml = `
    <p style="margin:0 0 10px;font-size:12px;color:${COLORS.helper};">${reasonLine}</p>
    <p style="margin:0 0 10px;font-size:12px;color:${COLORS.helper};">
      Need help?
      <a href="mailto:${SUPPORT_EMAIL}" style="color:${COLORS.brand};text-decoration:underline;font-weight:600;">${SUPPORT_EMAIL}</a>
    </p>
    <p style="margin:0 0 10px;font-size:12px;color:${COLORS.helper};">
      <a href="${FACEBOOK_URL}" style="color:${COLORS.helper};text-decoration:underline;">Facebook</a>
      &nbsp;·&nbsp;
      <a href="${INSTAGRAM_URL}" style="color:${COLORS.helper};text-decoration:underline;">Instagram</a>
      &nbsp;·&nbsp;
      <a href="${LINKEDIN_URL}" style="color:${COLORS.helper};text-decoration:underline;">LinkedIn</a>
      &nbsp;·&nbsp;
      <a href="${SITE_URL}" style="color:${COLORS.helper};text-decoration:underline;">advertisehomes.online</a>
    </p>
    <p style="margin:0;font-size:11px;color:${COLORS.helperSoft};">${BUSINESS_ADDRESS}</p>`;

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
              <td style="${STYLES.accentStrip}" height="4">&nbsp;</td>
            </tr>
            <tr>
              <td style="${STYLES.inner}">
                <a href="${SITE_URL}" style="${STYLES.brand}">AHO</a>
                <div style="margin-top:24px;color:${COLORS.ink};">${bodyHtml}</div>
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
