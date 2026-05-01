/**
 * Source of truth for AHO's Supabase-managed Auth email templates.
 *
 * These are the 5 templates Supabase Auth sends directly (signup
 * confirmation, magic link, password reset, change email, invite). They
 * live in project config, NOT in the codebase by default — Supabase
 * Auth substitutes `{{ .ConfirmationURL }}` etc. at send time.
 *
 * Pushed via `scripts/sync-supabase-email-templates.ts` against the
 * Management API. The dashboard UI works too; this module is the
 * machine-readable equivalent for reproducible deploys.
 *
 * Visual identity: matches the DP-2d in-codebase email layout
 * (`src/lib/email/templates/_layout.ts`) — warm cream canvas, 4-px
 * forest-green accent strip, white card, forest-green pill CTAs,
 * soft-cream footer.
 */

const SHARED_TOP = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>AHO</title>
  </head>
  <body style="background:#f4ede1;margin:0;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1612;letter-spacing:-0.01em;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid rgba(112,95,70,0.18);border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#1d5a3c;line-height:0;font-size:0;height:4px;" height="4">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 28px;line-height:1.55;font-size:15px;color:#3a342c;">
                <a href="{{ .SiteURL }}" style="font-weight:700;font-size:20px;letter-spacing:-0.02em;color:#1a1612;text-decoration:none;">AHO</a>
                <div style="margin-top:24px;color:#1a1612;">`;

const SHARED_BOTTOM = `                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;font-size:12px;color:#5e574d;border-top:1px solid rgba(112,95,70,0.18);background:#ebe1ce;">
                <p style="margin:0 0 10px;font-size:12px;color:#5e574d;">Need help? <a href="mailto:info@advertisehomes.online" style="color:#1d5a3c;text-decoration:underline;font-weight:600;">info@advertisehomes.online</a></p>
                <p style="margin:0 0 10px;font-size:12px;color:#5e574d;">
                  <a href="https://facebook.com/advertisehomesonline" style="color:#5e574d;text-decoration:underline;">Facebook</a>
                  &nbsp;·&nbsp;
                  <a href="https://instagram.com/advertisehomesonline" style="color:#5e574d;text-decoration:underline;">Instagram</a>
                  &nbsp;·&nbsp;
                  <a href="https://linkedin.com/company/advertisehomesonline" style="color:#5e574d;text-decoration:underline;">LinkedIn</a>
                  &nbsp;·&nbsp;
                  <a href="https://advertisehomes.online" style="color:#5e574d;text-decoration:underline;">advertisehomes.online</a>
                </p>
                <p style="margin:0;font-size:11px;color:#8a7e6c;">AHO · Advertise Homes Online · Santo Domingo, Dominican Republic</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

interface TemplateBody {
  heading: string;
  body: string;
  ctaLabel: string;
  helper: string;
  /** When true, append the raw URL below the helper for clients that
   *  strip CTA buttons (rare). Used on confirmation-style flows where
   *  the user MUST be able to recover the link manually. */
  includeRawUrl: boolean;
}

function compose({ heading, body, ctaLabel, helper, includeRawUrl }: TemplateBody): string {
  return (
    SHARED_TOP +
    `
                  <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:#1a1612;">${heading}</h1>
                  <p style="margin:0 0 18px;color:#3a342c;">${body}</p>
                  <p style="margin:0 0 24px;">
                    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:11px 22px;background:#1d5a3c;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px;letter-spacing:-0.01em;">${ctaLabel}</a>
                  </p>
                  <p style="margin:0;color:#5e574d;font-size:13px;">${helper}</p>` +
    (includeRawUrl
      ? `
                  <p style="margin:16px 0 0;color:#8a7e6c;font-size:11px;word-break:break-all;">{{ .ConfirmationURL }}</p>`
      : '') +
    `
` +
    SHARED_BOTTOM
  );
}

export interface AuthTemplate {
  /** Management-API field name for the subject. */
  subjectField: string;
  /** Management-API field name for the HTML content. */
  contentField: string;
  /** Human-readable label, used in script output only. */
  label: string;
  subject: string;
  content: string;
}

export const AUTH_TEMPLATES: AuthTemplate[] = [
  {
    label: 'Confirm signup',
    subjectField: 'mailer_subjects_confirmation',
    contentField: 'mailer_templates_confirmation_content',
    subject: 'Confirm your AHO account',
    content: compose({
      heading: 'Welcome to AHO',
      body: 'Tap the button below to confirm your email and finish setting up your account.',
      ctaLabel: 'Confirm my email',
      helper:
        "If you didn't sign up for AHO, you can safely ignore this email — no account will be created without confirmation.",
      includeRawUrl: true,
    }),
  },
  {
    label: 'Magic link',
    subjectField: 'mailer_subjects_magic_link',
    contentField: 'mailer_templates_magic_link_content',
    subject: 'Your AHO sign-in link',
    content: compose({
      heading: 'Sign in to AHO',
      body: 'Tap the button below to sign in. The link is single-use and expires in 1 hour.',
      ctaLabel: 'Sign me in',
      helper:
        "If you didn't request this link, you can safely ignore this email — no one can sign in to your account without it.",
      includeRawUrl: true,
    }),
  },
  {
    label: 'Reset password',
    subjectField: 'mailer_subjects_recovery',
    contentField: 'mailer_templates_recovery_content',
    subject: 'Reset your AHO password',
    content: compose({
      heading: 'Reset your password',
      body: 'Tap the button below to choose a new password. The link expires in 1 hour.',
      ctaLabel: 'Reset password',
      helper:
        "If you didn't request a password reset, you can safely ignore this email — your current password stays unchanged.",
      includeRawUrl: false,
    }),
  },
  {
    label: 'Change email',
    subjectField: 'mailer_subjects_email_change',
    contentField: 'mailer_templates_email_change_content',
    subject: 'Confirm your new email on AHO',
    content: compose({
      heading: 'Confirm your new email',
      body: 'You requested to change the email on your AHO account from <strong>{{ .Email }}</strong> to <strong>{{ .NewEmail }}</strong>. Tap below to confirm. The link expires in 1 hour.',
      ctaLabel: 'Confirm new email',
      helper:
        "If you didn't request this change, please contact us immediately so we can secure your account.",
      includeRawUrl: false,
    }),
  },
  {
    label: 'Invite user',
    subjectField: 'mailer_subjects_invite',
    contentField: 'mailer_templates_invite_content',
    subject: "You're invited to AHO",
    content: compose({
      heading: "You're invited to AHO",
      body: 'An admin invited you to join AHO. Tap below to set up your account.',
      ctaLabel: 'Accept invitation',
      helper:
        "If you weren't expecting this invitation, you can safely ignore this email.",
      includeRawUrl: false,
    }),
  },
];
