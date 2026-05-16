import { COLORS, buttonPrimary, buttonSecondary, emailLayout, escapeHtml } from './_layout';

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
    ? '¿Eres agente inmobiliario? Suscríbete al plan Agente para publicar propiedades en AHO y compartirlas en Facebook + Instagram + LinkedIn con un solo clic.'
    : 'Are you a real estate agent? Subscribe to the Agent plan to publish listings on AHO and share them on Facebook + Instagram + LinkedIn with a single click.';

  const ctaPrimary = isEs ? 'Explorar anuncios' : 'Browse listings';
  const ctaSecondary = isEs ? 'Convertirse en agente' : 'Become an agent';

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">${greeting}</h1>
    <p style="margin:0 0 18px;color:${COLORS.inkMuted};">${body}</p>
    <p style="margin:0 0 24px;color:${COLORS.inkMuted};">${agentNudge}</p>
    <div>
      ${buttonPrimary(escapeHtml(args.homeUrl), ctaPrimary)}
      ${buttonSecondary(escapeHtml(args.pricingUrl), ctaSecondary)}
    </div>`;

  const html = emailLayout({
    preheader: isEs ? 'Tu cuenta de AHO está lista.' : 'Your AHO account is ready.',
    bodyHtml,
  });

  return { subject, html };
}
