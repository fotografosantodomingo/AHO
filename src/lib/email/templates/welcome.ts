import { emailLayout, escapeHtml } from './_layout';

interface WelcomeArgs {
  email: string;
  locale: 'en' | 'es';
  /** Public URL to land on after acknowledgment — typically `/{locale}`. */
  homeUrl: string;
  /** URL to the pricing page so a brand-new user knows how to become an Agent. */
  pricingUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderWelcomeEmail(args: WelcomeArgs): RenderedEmail {
  const isEs = args.locale === 'es';
  const subject = isEs ? 'Bienvenido a AHO' : 'Welcome to AHO';

  const greeting = isEs ? '¡Bienvenido a AHO!' : 'Welcome to AHO!';
  const body = isEs
    ? `Tu cuenta (${escapeHtml(args.email)}) ya está lista. Puedes guardar tus propiedades favoritas, recibir alertas y contactar a los agentes con un clic.`
    : `Your account (${escapeHtml(
        args.email,
      )}) is ready. You can save favorite listings, get email alerts, and contact agents with one click.`;

  const agentNudge = isEs
    ? '¿Eres agente inmobiliario? Suscríbete al plan Agente para publicar propiedades en AHO y compartirlas en Facebook + Instagram con un solo clic.'
    : 'Are you a real estate agent? Subscribe to the Agent plan to publish listings on AHO and share them on Facebook + Instagram with a single click.';

  const ctaPrimary = isEs ? 'Explorar anuncios' : 'Browse listings';
  const ctaSecondary = isEs ? 'Convertirse en agente' : 'Become an agent';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;letter-spacing:-0.01em;">${greeting}</h1>
    <p style="margin:0 0 20px;color:#52525b;">${body}</p>
    <p style="margin:0 0 24px;color:#52525b;">${agentNudge}</p>
    <div>
      <a href="${escapeHtml(
        args.homeUrl,
      )}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">${ctaPrimary}</a>
      <a href="${escapeHtml(
        args.pricingUrl,
      )}" style="display:inline-block;margin-left:8px;padding:10px 18px;border:1px solid #e4e4e7;color:#18181b;text-decoration:none;border-radius:6px;">${ctaSecondary}</a>
    </div>`;

  const html = emailLayout({
    preheader: isEs ? 'Tu cuenta de AHO está lista.' : 'Your AHO account is ready.',
    bodyHtml,
  });

  return { subject, html };
}
