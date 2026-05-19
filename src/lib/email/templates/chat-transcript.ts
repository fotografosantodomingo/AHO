import { emailLayout, escapeHtml } from './_layout';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface ChatTranscriptMessage {
  role: 'user' | 'assistant';
  body: string;
  /** Optional ISO timestamp; rendered next to the bubble when present. */
  at?: string;
}

/**
 * Operator-facing transcript of a single chat conversation. Sent to
 * info@advertisehomes.online by /api/chat-transcript/email when the
 * visitor closes the chat widget (or the cron sweep finds a stale
 * conversation with no activity for 30+ min).
 *
 * Two widget sources, same email shape:
 *   - Per-agent <AiChatWidget>   — has a conversation_id; the route
 *                                  can pull canonical history from
 *                                  ai_conversation_messages
 *   - <AhoAssistantWidget>       — stateless; the widget POSTs the
 *                                  full message array directly
 *
 * Subscriber identity (name + email) comes from the pre-chat gate,
 * stamped at the top of the email so the operator can match a
 * conversation back to a newsletter contact.
 */
export function renderChatTranscriptEmail(args: {
  /** Which widget produced this transcript — e.g. 'per-agent' / 'aho-assistant'. */
  source: string;
  /** Public URL where the conversation happened (e.g. /en/properties/<slug>). */
  pageUrl: string | null;
  /** Pre-chat gate subscriber. NULL if the visitor was already
   *  signed-in and we skipped the gate. */
  subscriber: { name: string; email: string } | null;
  /** Optional conversation_id for cross-reference in the dashboard. */
  conversationId: string | null;
  /** Per-agent surface only — which agent's listing was being discussed. */
  agentName?: string | null;
  /** Locale of the conversation. */
  locale: string;
  /** Ordered list of messages, oldest first. */
  messages: ChatTranscriptMessage[];
  /** ISO of when the chat session ended (gate-close or last activity). */
  endedAt: string;
}): RenderedEmail {
  const visitorLabel = args.subscriber
    ? `${args.subscriber.name} <${args.subscriber.email}>`
    : '(anonymous visitor)';
  const sourceLabel =
    args.source === 'aho-assistant' ? 'AHO Assistant' : 'Per-agent chat';
  const headline = args.subscriber
    ? `Chat from ${args.subscriber.name}`
    : `Anonymous chat transcript`;

  const subject = args.subscriber
    ? `[AHO chat] ${args.subscriber.name} — ${sourceLabel}`
    : `[AHO chat] anonymous — ${sourceLabel}`;

  const messageRows = args.messages
    .map((m) => {
      const isUser = m.role === 'user';
      const bg = isUser ? '#ebe1ce' : '#ffffff';
      const align = isUser ? 'right' : 'left';
      const label = isUser ? 'Visitor' : 'AHO';
      const tsLine = m.at
        ? `<div style="font-size: 11px; color: #8a7e6c; margin-top: 4px;">${escapeHtml(
            m.at,
          )}</div>`
        : '';
      return `
        <tr>
          <td align="${align}" style="padding: 4px 0;">
            <div style="display: inline-block; max-width: 85%; padding: 10px 14px; background: ${bg}; border: 1px solid rgba(112, 95, 70, 0.18); border-radius: 12px; text-align: left;">
              <div style="font-size: 11px; color: #8a7e6c; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">${label}</div>
              <div style="font-size: 14px; line-height: 1.5; color: #1a1612; white-space: pre-wrap;">${escapeHtml(m.body)}</div>
              ${tsLine}
            </div>
          </td>
        </tr>`;
    })
    .join('');

  const metaLines: string[] = [];
  metaLines.push(`<li><strong>Source:</strong> ${escapeHtml(sourceLabel)}</li>`);
  metaLines.push(`<li><strong>Visitor:</strong> ${escapeHtml(visitorLabel)}</li>`);
  metaLines.push(`<li><strong>Locale:</strong> ${escapeHtml(args.locale)}</li>`);
  if (args.agentName) {
    metaLines.push(`<li><strong>Agent on page:</strong> ${escapeHtml(args.agentName)}</li>`);
  }
  if (args.pageUrl) {
    metaLines.push(
      `<li><strong>Page:</strong> <a href="${escapeHtml(args.pageUrl)}">${escapeHtml(args.pageUrl)}</a></li>`,
    );
  }
  if (args.conversationId) {
    metaLines.push(
      `<li><strong>Conversation ID:</strong> <code>${escapeHtml(args.conversationId)}</code></li>`,
    );
  }
  metaLines.push(`<li><strong>Ended:</strong> ${escapeHtml(args.endedAt)}</li>`);
  metaLines.push(`<li><strong>Messages:</strong> ${args.messages.length}</li>`);

  const bodyHtml = `
    <p style="font-size: 15px; margin: 0 0 8px;"><strong>${escapeHtml(headline)}</strong></p>
    <p style="font-size: 13px; color: #5e574d; margin: 0 0 20px;">Chat session just ended. Full transcript below.</p>
    <ul style="font-size: 13px; line-height: 1.7; padding-left: 1.25rem; margin: 0 0 20px;">${metaLines.join('')}</ul>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top: 16px;">
      ${messageRows}
    </table>
    <p style="font-size: 12px; color: #6b6356; margin-top: 28px;">
      The visitor has been added to AHO's newsletter list (Brevo) with their consent.
      To follow up directly, reply to the visitor at the email above. To open the
      conversation in the admin dashboard${args.conversationId ? ' (per-agent surface)' : ''},
      use the Conversation ID.
    </p>
  `;

  // Plain-text fallback. Keep it lean — most operator inboxes render HTML
  // anyway; the text version is the deliverability-safety net.
  const textLines = [
    headline,
    '',
    `Source: ${sourceLabel}`,
    `Visitor: ${visitorLabel}`,
    `Locale: ${args.locale}`,
    args.agentName ? `Agent on page: ${args.agentName}` : null,
    args.pageUrl ? `Page: ${args.pageUrl}` : null,
    args.conversationId ? `Conversation ID: ${args.conversationId}` : null,
    `Ended: ${args.endedAt}`,
    `Messages: ${args.messages.length}`,
    '',
    '--- TRANSCRIPT ---',
    '',
    ...args.messages.map((m) => {
      const label = m.role === 'user' ? 'Visitor' : 'AHO';
      const ts = m.at ? ` (${m.at})` : '';
      return `${label}${ts}:\n${m.body}\n`;
    }),
    '',
    '— AHO',
  ];

  return {
    subject,
    html: emailLayout({
      preheader: `${args.messages.length} messages from ${visitorLabel}`,
      bodyHtml,
    }),
    text: textLines.filter((l) => l !== null).join('\n'),
  };
}
