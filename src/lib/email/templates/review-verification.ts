import { emailLayout, escapeHtml } from './_layout';

interface ReviewVerificationArgs {
  reviewerName: string;
  agentName: string;
  /** Locale of the review at submission time. Locks email language. */
  locale: 'en' | 'es';
  /** Absolute URL to the verification landing page. */
  verifyUrl: string;
  /** Hours until the link expires (display only). */
  expiresInHours: number;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderReviewVerificationEmail(
  args: ReviewVerificationArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';
  const subject = isEs
    ? 'Confirma tu reseña en AHO'
    : 'Confirm your review on AHO';

  const greeting = isEs
    ? `Hola ${escapeHtml(args.reviewerName)},`
    : `Hi ${escapeHtml(args.reviewerName)},`;

  const intro = isEs
    ? `Recibimos tu reseña sobre <strong>${escapeHtml(
        args.agentName,
      )}</strong>. Para publicarla, confirma tu correo haciendo clic en el botón:`
    : `We received your review of <strong>${escapeHtml(
        args.agentName,
      )}</strong>. To publish it, please confirm your email by clicking the button below:`;

  const cta = isEs ? 'Confirmar mi reseña' : 'Confirm my review';

  const note = isEs
    ? `Este enlace expira en ${args.expiresInHours} horas. Tu reseña quedará en revisión por nuestro equipo antes de aparecer públicamente. Si no enviaste esta reseña, puedes ignorar este correo.`
    : `This link expires in ${args.expiresInHours} hours. After confirmation, your review goes to our team for a quick review before appearing publicly. If you didn't submit this review, you can safely ignore this email.`;

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.01em;">${greeting}</h1>
    <p style="margin:0 0 20px;color:#52525b;">${intro}</p>
    <div style="margin:0 0 24px;">
      <a href="${escapeHtml(
        args.verifyUrl,
      )}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">${cta}</a>
    </div>
    <p style="margin:0;color:#71717a;font-size:13px;">${note}</p>
    <p style="margin:16px 0 0;color:#a1a1aa;font-size:11px;word-break:break-all;">${escapeHtml(args.verifyUrl)}</p>`;

  const html = emailLayout({
    preheader: isEs
      ? 'Confirma tu correo para publicar tu reseña.'
      : "Confirm your email to publish your review.",
    bodyHtml,
  });

  return { subject, html };
}
