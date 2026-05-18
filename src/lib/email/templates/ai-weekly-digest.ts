import { buttonPrimary, COLORS, emailLayout, escapeHtml } from './_layout';

/**
 * Weekly AI digest — Phase 4 of `docs/AI_CONVERSION_PLAN.md`.
 *
 * Sent every Monday at 09:00 (UTC for v1; per-timezone is v2) to the
 * org owner. Skips the send entirely when `conversations === 0` for
 * the past week (the "no zero-activity guilt-trip" rule from §4 R5
 * of the plan).
 *
 * The body wraps three blocks:
 *   1. A 3-tile stats row — conversations, leads captured, viewings booked.
 *   2. A "top conversations" list — first 3 conversations of the week,
 *      labelled with the buyer's opening message + the listing title.
 *   3. A single forest-green CTA pill linking back to /dashboard/ai-inbox.
 *
 * Bilingual: takes a `locale` of 'en' | 'es' and renders subject + body
 * in that language. Marketing locales (pl/pt/de/fr/it) fall back to
 * English at the caller; this template doesn't try to be all things to
 * all locales.
 */

export interface DigestTopConversation {
  /** The buyer's first message of the conversation (truncated upstream
   *  to ~140 chars). Used as the headline of each row. */
  buyerOpeningMessage: string;
  /** Listing title the conversation is anchored to. `null` for general
   *  inquiries that don't have a listing context. */
  listingTitle: string | null;
}

export interface AiWeeklyDigestArgs {
  agentName: string | null;
  /** Counts for the past 7 days. */
  conversations: number;
  leadsCaptured: number;
  viewingsBooked: number;
  /** Up to 3 conversations to spotlight at the top of the list. */
  topConversations: DigestTopConversation[];
  /** Absolute URL to `/dashboard/ai-inbox` in the recipient's locale. */
  inboxUrl: string;
  /** Recipient's locale — drives subject + body language. */
  locale: 'en' | 'es';
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderAiWeeklyDigestEmail(
  args: AiWeeklyDigestArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';

  const subject = isEs
    ? `${args.conversations} nuevas conversaciones IA esta semana — revisa tu bandeja`
    : `${args.conversations} new AI conversations this week — review your inbox`;

  const labels = isEs
    ? {
        greeting: (name: string) => `Hola ${name},`,
        intro:
          'Aquí tienes el resumen semanal de la actividad de tu agente IA en AHO.',
        statConversations: 'Conversaciones',
        statLeads: 'Contactos captados',
        statViewings: 'Visitas reservadas',
        topHeading: 'Conversaciones destacadas',
        noListing: 'Consulta general',
        cta: 'Abrir la bandeja IA',
        outro:
          'Tu bandeja IA tiene borradores listos para tu revisión. Aprobar o editar cada respuesta toma menos de un minuto.',
        preheader: (n: number) =>
          `${n} conversaciones esta semana — abre tu bandeja IA para responder a los compradores.`,
        anonymous: 'Hola',
      }
    : {
        greeting: (name: string) => `Hi ${name},`,
        intro:
          'Here is the weekly summary of your AI agent activity on AHO.',
        statConversations: 'Conversations',
        statLeads: 'Leads captured',
        statViewings: 'Viewings booked',
        topHeading: 'Conversations to look at',
        noListing: 'General inquiry',
        cta: 'Open the AI inbox',
        outro:
          'Your AI inbox has drafts ready for your review. Approving or editing each reply takes under a minute.',
        preheader: (n: number) =>
          `${n} conversations this week — open your AI inbox to reply to buyers.`,
        anonymous: 'Hi',
      };

  const greetingName = args.agentName ?? labels.anonymous;
  const greeting = labels.greeting(greetingName);

  const statsBlock = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:8px 0 20px;">
      <tr>
        ${statCell(args.conversations, labels.statConversations)}
        ${statCell(args.leadsCaptured, labels.statLeads)}
        ${statCell(args.viewingsBooked, labels.statViewings)}
      </tr>
    </table>`;

  const topList = args.topConversations.length
    ? `
      <div style="margin:24px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${COLORS.helper};">
        ${labels.topHeading}
      </div>
      <ul style="margin:0 0 20px;padding:0;list-style:none;">
        ${args.topConversations
          .slice(0, 3)
          .map((c) => topRow(c, labels.noListing))
          .join('')}
      </ul>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 16px;color:${COLORS.ink};font-weight:600;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 8px;color:${COLORS.inkMuted};">${escapeHtml(labels.intro)}</p>
    ${statsBlock}
    ${topList}
    <p style="margin:0 0 20px;color:${COLORS.inkMuted};">${escapeHtml(labels.outro)}</p>
    <div style="margin-top:16px;">${buttonPrimary(args.inboxUrl, labels.cta)}</div>`;

  const html = emailLayout({
    preheader: labels.preheader(args.conversations),
    bodyHtml,
  });

  // Plain-text fallback — same shape, no formatting. Brevo sends both
  // parts when `textContent` is set, which improves deliverability +
  // gives screen readers a clean read.
  const textLines: string[] = [
    greeting,
    '',
    labels.intro,
    '',
    `${labels.statConversations}: ${args.conversations}`,
    `${labels.statLeads}: ${args.leadsCaptured}`,
    `${labels.statViewings}: ${args.viewingsBooked}`,
  ];
  if (args.topConversations.length) {
    textLines.push('', `${labels.topHeading}:`);
    for (const c of args.topConversations.slice(0, 3)) {
      const title = c.listingTitle ?? labels.noListing;
      textLines.push(`- "${truncate(c.buyerOpeningMessage, 140)}" — ${title}`);
    }
  }
  textLines.push('', labels.outro, '', `${labels.cta}: ${args.inboxUrl}`);
  const text = textLines.join('\n');

  return { subject, html, text };
}

function statCell(value: number, label: string): string {
  return `
    <td align="center" valign="top" style="width:33%;padding:14px 8px;background:${COLORS.bandSoft};border:1px solid ${COLORS.cardBorder};border-radius:8px;">
      <div style="font-size:24px;font-weight:700;color:${COLORS.ink};line-height:1.1;letter-spacing:-0.02em;">${value}</div>
      <div style="margin-top:4px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${COLORS.helper};">${escapeHtml(label)}</div>
    </td>`;
}

function topRow(c: DigestTopConversation, fallbackTitle: string): string {
  const title = c.listingTitle ?? fallbackTitle;
  return `
    <li style="padding:12px 0;border-bottom:1px solid ${COLORS.cardBorder};">
      <div style="font-size:15px;color:${COLORS.ink};font-weight:500;line-height:1.45;">
        “${escapeHtml(truncate(c.buyerOpeningMessage, 140))}”
      </div>
      <div style="margin-top:4px;font-size:13px;color:${COLORS.helper};">${escapeHtml(title)}</div>
    </li>`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
