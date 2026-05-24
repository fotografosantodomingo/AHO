import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { sendEmail } from '@/lib/email/brevo';
import {
  renderChatTranscriptEmail,
  type ChatTranscriptMessage,
} from '@/lib/email/templates/chat-transcript';
import { LOCALES } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/chat-transcript/email
 *
 * Sent by the chat widgets when the visitor closes the chat (× button)
 * or when the browser tears the page down (navigator.sendBeacon on
 * `pagehide` / `beforeunload`). Body carries the full message array
 * plus the subscriber identity collected by the pre-chat gate. The
 * route formats the transcript as an HTML+text email and ships it to
 * `CHAT_TRANSCRIPT_TO` (defaults to info@advertisehomes.online).
 *
 * Anon-callable on purpose — visitors close the chat before they're
 * "authenticated" to anything. Defenses:
 *   - Empty-conversation guard: a session where the visitor never
 *     typed anything (greeting only, no user messages) is silently
 *     dropped. No spam to the operator inbox.
 *   - Message-count cap (200): protects against client-side bloat.
 *   - Body-length cap (16 KB / message; 256 KB total): protects
 *     against an abusive client packing the operator inbox.
 *   - Brevo's own rate-limit on the outbound send.
 *
 * Idempotency: NOT enforced server-side. The widget DOES guard
 * against double-firing on the client (sent + sendingDone refs); if
 * a duplicate slips through (e.g. user re-opens then closes again
 * quickly) the operator gets a second email with identical content
 * — annoying but not destructive.
 */

const MAX_MESSAGES = 200;
const MAX_BODY_PER_MSG = 16 * 1024;
const MAX_TOTAL_BODY = 256 * 1024;

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  body: z.string().min(1).max(MAX_BODY_PER_MSG),
  at: z.string().optional(),
});

const BodySchema = z.object({
  source: z.enum(['per-agent', 'aho-assistant']),
  locale: z.enum(LOCALES),
  pageUrl: z.string().url().max(2048).nullable().optional(),
  subscriber: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(254),
    })
    .nullable()
    .optional(),
  conversationId: z.string().uuid().nullable().optional(),
  agentName: z.string().trim().min(1).max(120).nullable().optional(),
  messages: z.array(MessageSchema).max(MAX_MESSAGES),
  endedAt: z.string().min(1).max(40),
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const args = parsed.data;

  // Empty-chat guard — count user messages. A session that closed
  // without the visitor ever typing isn't worth emailing.
  const userTurnCount = args.messages.filter((m) => m.role === 'user').length;
  if (userTurnCount === 0) {
    return NextResponse.json({ ok: true, skipped: 'no_user_messages' });
  }

  // Total-body cap — defense against a single message under
  // MAX_BODY_PER_MSG slipping a giant payload via many messages.
  const totalBytes = args.messages.reduce((s, m) => s + m.body.length, 0);
  if (totalBytes > MAX_TOTAL_BODY) {
    return NextResponse.json(
      { ok: false, errorCode: 'transcript_too_large', totalBytes },
      { status: 413 },
    );
  }

  const to = (process.env.CHAT_TRANSCRIPT_TO ?? 'info@advertisehomes.online').trim();

  const messages: ChatTranscriptMessage[] = args.messages.map((m) => ({
    role: m.role,
    body: m.body,
    ...(m.at ? { at: m.at } : {}),
  }));

  const rendered = renderChatTranscriptEmail({
    source: args.source,
    pageUrl: args.pageUrl ?? null,
    subscriber: args.subscriber ?? null,
    conversationId: args.conversationId ?? null,
    agentName: args.agentName ?? null,
    locale: args.locale,
    messages,
    endedAt: args.endedAt,
  });

  const result = await sendEmail({
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    // Set the visitor's email as reply-to so the operator can hit
    // reply and respond to the visitor directly. Falls back to the
    // default From if there's no subscriber (anon-cookie session).
    ...(args.subscriber?.email ? { replyTo: args.subscriber.email } : {}),
  });

  if (!result.sent) {
    console.error('[chat-transcript] send failed', {
      to,
      conversationId: args.conversationId,
      subscriberEmail: args.subscriber?.email,
      error: result.error,
    });
    // Don't echo Brevo's raw error to the anon caller — the client only
    // needs to know the send failed. Full reason is in server logs.
    return NextResponse.json(
      { ok: false, errorCode: 'send_failed' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, messageCount: args.messages.length });
}
