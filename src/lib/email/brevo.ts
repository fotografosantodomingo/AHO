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
  /** Override the default From address. Used by the AI agent so
   *  outbound replies appear FROM the per-agent address
   *  (`<agent-slug>@reply.advertisehomes.online`), not the generic
   *  AHO sender. Sender domain must still be verified in Brevo. */
  fromEmail?: string;
  /** Override the default From display name. */
  fromName?: string;
  /** Arbitrary RFC-5322 headers to attach to the outbound email.
   *  Brevo's API accepts a `headers` object keyed by name. Used by
   *  the AI agent to set `In-Reply-To`, `References`, and
   *  `List-Unsubscribe` so Gmail/Outlook thread the reply correctly
   *  and the buyer can one-click unsubscribe. */
  headers?: Record<string, string>;
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

  const fromEmail = args.fromEmail ?? process.env.BREVO_FROM_EMAIL ?? DEFAULT_FROM_EMAIL;
  const fromName = args.fromName ?? process.env.BREVO_FROM_NAME ?? DEFAULT_FROM_NAME;

  const body: Record<string, unknown> = {
    sender: { email: fromEmail, name: fromName },
    to: [{ email: args.to }],
    subject: args.subject,
    htmlContent: args.html,
  };
  if (args.text) body.textContent = args.text;
  if (args.replyTo) body.replyTo = { email: args.replyTo };
  if (args.headers && Object.keys(args.headers).length > 0) {
    body.headers = args.headers;
  }

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

// ──────────────────────────────────────────────────────────────────
// Threaded reply helper for the AI customer-service agent
// ──────────────────────────────────────────────────────────────────

export interface SendThreadedReplyArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** From address for this reply — typically the per-agent
   *  `<agent-slug>@reply.advertisehomes.online`. Defaults to the
   *  BREVO_FROM_EMAIL env var if omitted. */
  fromEmail?: string;
  fromName?: string;
  /** Opaque per-conversation reply-to: typically
   *  `leads+<hmac>@reply.advertisehomes.online`. When the buyer
   *  hits Reply, Cloudflare Email Routing dispatches by this token
   *  back to the same conversation. */
  replyTo?: string;
  /** The Message-ID this reply is in response to. Becomes the
   *  outbound `In-Reply-To` header. Pass WITHOUT angle brackets;
   *  this helper wraps. */
  inReplyToMessageId: string;
  /** Ordered ancestor Message-IDs from email_messages.references_chain
   *  (oldest → newest), plus `inReplyToMessageId` at the tail. The
   *  helper composes the outbound `References` header per RFC-5322. */
  referencesChain?: string[];
  /** RFC 8058 one-click unsubscribe URL. When set the helper attaches
   *  `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. */
  unsubscribeUrl?: string;
  /** Additional headers to pass through (e.g. List-Id, X-Conversation-Id
   *  for in-pipe correlation logs). */
  extraHeaders?: Record<string, string>;
}

/**
 * Send a threaded reply via Brevo. The AI customer-service agent's
 * outbound email helper.
 *
 * Sets the In-Reply-To + References headers so Gmail/Outlook stitch
 * the reply into the buyer's existing thread. Also attaches the
 * RFC-8058 one-click unsubscribe pair when an unsubscribe URL is
 * provided.
 *
 * Note on Brevo header support: Brevo's v3 `/smtp/email` endpoint
 * accepts an arbitrary `headers` object (verified against their docs
 * as of 2026-05). If a future API change breaks this, the fallback
 * shape is to embed the headers as `X-Mailin-custom` metadata + ask
 * Brevo support to enable raw-header passthrough on the account.
 */
export async function sendEmailWithThreading(
  args: SendThreadedReplyArgs,
): Promise<SendEmailResult> {
  const headers: Record<string, string> = {};

  const inReplyToBracketed = wrapMessageId(args.inReplyToMessageId);
  if (inReplyToBracketed) headers['In-Reply-To'] = inReplyToBracketed;

  const refs = (args.referencesChain ?? [])
    .map(wrapMessageId)
    .filter((s): s is string => Boolean(s));
  // Standard practice: References = parents + In-Reply-To, in chronological order.
  if (inReplyToBracketed && !refs.includes(inReplyToBracketed)) {
    refs.push(inReplyToBracketed);
  }
  if (refs.length > 0) headers['References'] = refs.join(' ');

  if (args.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${args.unsubscribeUrl}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  if (args.extraHeaders) {
    for (const [k, v] of Object.entries(args.extraHeaders)) headers[k] = v;
  }

  const sendArgs: SendEmailArgs = {
    to: args.to,
    subject: args.subject,
    html: args.html,
    headers,
  };
  if (args.text) sendArgs.text = args.text;
  if (args.fromEmail) sendArgs.fromEmail = args.fromEmail;
  if (args.fromName) sendArgs.fromName = args.fromName;
  if (args.replyTo) sendArgs.replyTo = args.replyTo;

  return sendEmail(sendArgs);
}

function wrapMessageId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<+|>+$/g, '');
  if (!trimmed) return null;
  return `<${trimmed}>`;
}
