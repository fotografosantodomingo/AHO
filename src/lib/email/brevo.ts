import 'server-only';

/**
 * Brevo (formerly Sendinblue) transactional-email wrapper.
 *
 * Replaces the earlier Resend wrapper. Same shape: `sendEmail()` with the
 * same args + result types, no-ops with a console warning when
 * `BREVO_API_KEY` is unset so local-dev / preview deploys without the key
 * don't blow up.
 *
 * Why HTTP API and not the npm SDK: this runs on Cloudflare Pages Edge
 * runtime, which doesn't allow Node.js builtins. Brevo's REST endpoint is
 * a single fetch.
 *
 * Setup needed (PO action):
 *   1. Brevo account + transactional API key in `.env.local` as
 *      `BREVO_API_KEY` (also added as a Pages secret for production).
 *   2. Verify the sending domain `advertisehomes.online` in Brevo
 *      (Senders, Domains & Dedicated IPs → Domains → Add → DKIM/Brevo
 *      records). Otherwise the API returns 401 / 400 with a domain-not-
 *      authorized error.
 *   3. (Separate, also PO action) Configure Supabase Auth → SMTP to
 *      relay through Brevo SMTP (smtp-relay.brevo.com:587 + Brevo SMTP
 *      key) so that the *signup confirmation / password reset / magic
 *      link* emails — which Supabase sends, NOT this wrapper — actually
 *      go out. See docs/OPEN_QUESTIONS.md "Brevo + Supabase SMTP".
 *
 * Default sender:
 *   `AHO <info@advertisehomes.online>` — override via `BREVO_FROM_EMAIL`
 *   and `BREVO_FROM_NAME`. Per PO directive 2026-05-06: send FROM the
 *   monitored mailbox so legitimate user replies (questions, issues)
 *   reach a human instead of bouncing off a `noreply@` address.
 */

const API_URL = 'https://api.brevo.com/v3/smtp/email';

const DEFAULT_FROM_NAME = 'AHO';
const DEFAULT_FROM_EMAIL = 'info@advertisehomes.online';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text fallback. If omitted, the HTML is sent without text. */
  text?: string;
  /** Reply-To address — useful so an agent can hit reply on a lead
   *  notification and respond to the buyer directly. */
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  error?: string;
}

interface BrevoResponse {
  messageId?: string;
  code?: string;
  message?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn(
      `[email] BREVO_API_KEY not set; skipping send to=${args.to} subject=${JSON.stringify(args.subject)}`,
    );
    return { sent: false };
  }

  const fromEmail = process.env.BREVO_FROM_EMAIL ?? DEFAULT_FROM_EMAIL;
  const fromName = process.env.BREVO_FROM_NAME ?? DEFAULT_FROM_NAME;

  const body: Record<string, unknown> = {
    sender: { email: fromEmail, name: fromName },
    to: [{ email: args.to }],
    subject: args.subject,
    htmlContent: args.html,
  };
  if (args.text) body.textContent = args.text;
  if (args.replyTo) body.replyTo = { email: args.replyTo };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as BrevoResponse;
    if (!res.ok) {
      console.error('[email] brevo send failed', {
        to: args.to,
        status: res.status,
        code: data.code,
        message: data.message,
      });
      return { sent: false, error: data.message ?? `http_${res.status}` };
    }
    return { sent: true, id: data.messageId };
  } catch (e) {
    console.error('[email] brevo send threw', { to: args.to, error: e });
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
