import { emailLayout, escapeHtml } from './_layout';

interface ReviewPublishedArgs {
  agentFirstName: string;
  reviewerName: string;
  rating: number; // 1-5
  bodyExcerpt: string; // truncated to ~140 chars
  /** Locale of the agent's preferred_language. */
  locale: 'en' | 'es';
  /** Absolute URL to the agent's reviews dashboard for replying. */
  replyUrl: string;
  /** Absolute URL to the public agent profile so they can see it live. */
  publicProfileUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderReviewPublishedEmail(
  args: ReviewPublishedArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';

  // Use stars as a visual signal in the subject — survives email clients
  // that don't render HTML (Gmail's preview pane).
  const stars = '★'.repeat(args.rating) + '☆'.repeat(5 - args.rating);

  const subject = isEs
    ? `Nueva reseña ${stars} de ${args.reviewerName} en AHO`
    : `New review ${stars} from ${args.reviewerName} on AHO`;

  const greeting = isEs
    ? `Hola ${escapeHtml(args.agentFirstName)},`
    : `Hi ${escapeHtml(args.agentFirstName)},`;

  const intro = isEs
    ? `<strong>${escapeHtml(args.reviewerName)}</strong> publicó una reseña en tu perfil:`
    : `<strong>${escapeHtml(args.reviewerName)}</strong> just published a review on your profile:`;

  const ctaReply = isEs ? 'Responder a la reseña' : 'Reply to review';
  const ctaProfile = isEs ? 'Ver mi perfil público' : 'View my public profile';

  const tip = isEs
    ? 'Una respuesta rápida y profesional aumenta la confianza de los compradores que visitan tu perfil.'
    : 'A quick, professional reply boosts trust with buyers who visit your profile.';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.01em;">${greeting}</h1>
    <p style="margin:0 0 16px;color:#52525b;">${intro}</p>
    <div style="margin:0 0 20px;padding:16px;border:1px solid #e4e4e7;border-radius:6px;background:#fafafa;">
      <div style="font-size:18px;color:#f59e0b;letter-spacing:1px;">${stars}</div>
      <p style="margin:8px 0 0;color:#3f3f46;line-height:1.55;">${escapeHtml(args.bodyExcerpt)}</p>
    </div>
    <div style="margin:0 0 16px;">
      <a href="${escapeHtml(
        args.replyUrl,
      )}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">${ctaReply}</a>
      <a href="${escapeHtml(
        args.publicProfileUrl,
      )}" style="display:inline-block;margin-left:8px;padding:10px 18px;border:1px solid #e4e4e7;color:#18181b;text-decoration:none;border-radius:6px;">${ctaProfile}</a>
    </div>
    <p style="margin:0;color:#71717a;font-size:13px;">${tip}</p>`;

  const html = emailLayout({
    preheader: isEs
      ? `${args.reviewerName} dejó ${args.rating} estrellas en tu perfil.`
      : `${args.reviewerName} left ${args.rating} stars on your profile.`,
    bodyHtml,
  });

  return { subject, html };
}
