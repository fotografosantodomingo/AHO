import { COLORS, buttonPrimary, emailLayout, escapeHtml } from './_layout';

interface ReviewApprovedReviewerArgs {
  reviewerName: string;
  agentName: string;
  rating: number;
  bodyExcerpt: string;
  /** Locale of the review (used for the email body language). */
  locale: 'en' | 'es';
  /** Absolute URL to the agent's public profile so the reviewer can see their review live. */
  publicProfileUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Sent to the reviewer when an admin approves their review (status →
 * 'published'). Closes the loop on the verification flow: reviewer
 * submitted, confirmed via email, then the platform vetted it. They
 * should know it's now public.
 */
export function renderReviewApprovedReviewerEmail(
  args: ReviewApprovedReviewerArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';
  const stars = '★'.repeat(args.rating) + '☆'.repeat(5 - args.rating);

  const subject = isEs
    ? 'Tu reseña en AHO ya está publicada'
    : 'Your AHO review is now live';

  const greeting = isEs
    ? `Hola ${escapeHtml(args.reviewerName)},`
    : `Hi ${escapeHtml(args.reviewerName)},`;

  const intro = isEs
    ? `Buenas noticias — tu reseña sobre <strong>${escapeHtml(
        args.agentName,
      )}</strong> ya está publicada en AHO.`
    : `Good news — your review of <strong>${escapeHtml(
        args.agentName,
      )}</strong> is now published on AHO.`;

  const cta = isEs ? 'Ver el perfil' : 'View the profile';

  const note = isEs
    ? 'Gracias por compartir tu experiencia. Tu opinión ayuda a otros compradores a elegir mejor.'
    : 'Thanks for sharing your experience. Your review helps other buyers choose with confidence.';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">${greeting}</h1>
    <p style="margin:0 0 16px;color:${COLORS.inkMuted};">${intro}</p>
    <div style="margin:0 0 20px;padding:16px;border:1px solid ${COLORS.cardBorder};border-radius:8px;background:${COLORS.bandSoft};">
      <div style="font-size:18px;color:#b8893a;letter-spacing:1px;">${stars}</div>
      <p style="margin:8px 0 0;color:${COLORS.ink};line-height:1.55;">${escapeHtml(args.bodyExcerpt)}</p>
    </div>
    <div style="margin:0 0 24px;">${buttonPrimary(escapeHtml(args.publicProfileUrl), cta)}</div>
    <p style="margin:0;color:${COLORS.helper};font-size:13px;">${note}</p>`;

  const html = emailLayout({
    preheader: isEs
      ? `Tu reseña sobre ${args.agentName} está publicada.`
      : `Your review of ${args.agentName} is published.`,
    bodyHtml,
  });

  return { subject, html };
}
