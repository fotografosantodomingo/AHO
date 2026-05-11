import { COLORS, emailLayout, escapeHtml } from './_layout';

interface ReviewRejectedReviewerArgs {
  reviewerName: string;
  agentName: string;
  /** Locale of the review (used for the email body language). */
  locale: 'en' | 'es';
  /** Optional moderator note shown to the reviewer. Trimmed; empty
   *  treated as no reason given. */
  moderationNotes?: string | null;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Sent to the reviewer when an admin rejects their review (status →
 * 'rejected'). Includes the moderator note when present so the reviewer
 * understands why; falls back to a generic policy-violation line. No
 * CTA — there's nothing useful for them to click; the next action is
 * theirs (rewrite + resubmit) and we don't deep-link the form.
 */
export function renderReviewRejectedReviewerEmail(
  args: ReviewRejectedReviewerArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';

  const subject = isEs
    ? 'Tu reseña en AHO no fue publicada'
    : "Your AHO review wasn't published";

  const greeting = isEs
    ? `Hola ${escapeHtml(args.reviewerName)},`
    : `Hi ${escapeHtml(args.reviewerName)},`;

  const intro = isEs
    ? `Revisamos tu reseña sobre <strong>${escapeHtml(
        args.agentName,
      )}</strong> y, lamentablemente, no la publicaremos.`
    : `We've reviewed your submission about <strong>${escapeHtml(
        args.agentName,
      )}</strong> and, unfortunately, we won't be publishing it.`;

  const trimmedNote = (args.moderationNotes ?? '').trim();
  const reasonBlock = trimmedNote
    ? `<div style="margin:0 0 20px;padding:16px;border:1px solid ${COLORS.cardBorder};border-radius:8px;background:${COLORS.bandSoft};">
        <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${COLORS.helper};">${
          isEs ? 'Motivo del moderador' : 'Reason from the moderator'
        }</p>
        <p style="margin:0;color:${COLORS.ink};line-height:1.55;">${escapeHtml(trimmedNote)}</p>
      </div>`
    : `<p style="margin:0 0 16px;color:${COLORS.inkMuted};">${
        isEs
          ? 'Esto puede deberse a contenido fuera de nuestras pautas (lenguaje ofensivo, datos personales, contenido no relacionado con la experiencia con el agente o sospecha de spam).'
          : 'This is usually because the content fell outside our guidelines (offensive language, personal data, content unrelated to the agent experience, or suspected spam).'
      }</p>`;

  const closing = isEs
    ? 'Si crees que se trató de un error, puedes responder a este correo y revisaremos tu caso. Si quieres, puedes enviar una nueva reseña ajustada a las pautas en cualquier momento.'
    : "If you think this was a mistake, just reply to this email and we'll take another look. You're also welcome to submit a revised review at any time.";

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">${greeting}</h1>
    <p style="margin:0 0 16px;color:${COLORS.inkMuted};">${intro}</p>
    ${reasonBlock}
    <p style="margin:0;color:${COLORS.helper};font-size:13px;">${closing}</p>`;

  const html = emailLayout({
    preheader: isEs
      ? `Tu reseña sobre ${args.agentName} no fue publicada.`
      : `Your review of ${args.agentName} wasn't published.`,
    bodyHtml,
  });

  return { subject, html };
}
