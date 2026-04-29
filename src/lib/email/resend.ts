import 'server-only';
import { Resend } from 'resend';

/**
 * Resend wrapper. Optional: if `RESEND_API_KEY` is not set, all `sendEmail`
 * calls become no-ops with a console warning. Local dev / preview deploys
 * without the key keep working — no errors thrown, no flow broken.
 *
 * Setup needed before this actually delivers mail (PO action):
 *   - Resend account + API key
 *   - Verify the sending domain (`mail.advertisehomes.online`) per HANDOFF §20.4
 *     (SPF + DKIM + DMARC records, see `docs/DNS.md`)
 *   - Add `RESEND_API_KEY` and (optionally) `RESEND_FROM` to `.env.local`
 *
 * Default `from`: `AHO <noreply@mail.advertisehomes.online>`. Override with
 * `RESEND_FROM` env var if the verified domain differs.
 */

let cached: Resend | null = null;

function getClient(): Resend | null {
  if (cached) return cached;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  cached = new Resend(key);
  return cached;
}

const DEFAULT_FROM = 'AHO <noreply@mail.advertisehomes.online>';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  /** Optional plain-text fallback. If omitted, the HTML is sent without text. */
  text?: string;
  /** Reply-To header — useful so an agent can hit reply on a lead notification
   *  and respond to the buyer directly. */
  replyTo?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const client = getClient();
  if (!client) {
    console.warn(
      `[email] RESEND_API_KEY not set; skipping send to=${args.to} subject=${JSON.stringify(args.subject)}`,
    );
    return { sent: false };
  }
  const from = process.env.RESEND_FROM ?? DEFAULT_FROM;
  try {
    const result = await client.emails.send({
      from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      ...(args.text ? { text: args.text } : {}),
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    });
    if (result.error) {
      console.error('[email] send failed', { to: args.to, error: result.error });
      return { sent: false, error: String(result.error) };
    }
    return { sent: true, id: result.data?.id };
  } catch (e) {
    console.error('[email] send threw', { to: args.to, error: e });
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Test seam — clear the cached client between runs. */
export function __resetEmailClientForTests() {
  cached = null;
}
