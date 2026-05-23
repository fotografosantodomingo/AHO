import { COLORS, buttonPrimary, emailLayout, escapeHtml } from './_layout';

/** First-name extractor that satisfies noUncheckedIndexedAccess. */
function firstName(full: string): string {
  const trimmed = full.trim();
  return trimmed.split(' ')[0] ?? trimmed;
}

interface FoundingAgentWelcomeArgs {
  /** Applicant's full name. */
  fullName: string;
  /** Applicant locale for the email body — falls back to en. */
  locale: 'en' | 'es';
  /** Their city, included so the email reads like a real human read it. */
  city: string;
  /** WhatsApp link the CEO will follow up on — used by the applicant
   *  to verify their number was captured. NULL if they didn't share it. */
  whatsappDisplay: string | null;
  /** Link to the founding-agent landing page so they can come back to
   *  the program details. */
  programUrl: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Welcome email fired immediately after a Founding 50 application is
 * accepted. Two-language v1 (EN + ES) — DR-market priority. The voice
 * is "from the founder," signed by Michał, not a SaaS-bot tone.
 *
 * Purpose: (1) confirm receipt, (2) set expectations for next steps
 * (CEO replies within 24-48h via WhatsApp), (3) restate the founder
 * rate benefit so the applicant remembers why they applied.
 */
export function renderFoundingAgentWelcomeEmail(
  args: FoundingAgentWelcomeArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';
  const subject = isEs
    ? `¡Bienvenido a Founding 50, ${firstName(args.fullName)}!`
    : `Welcome to Founding 50, ${firstName(args.fullName)}!`;

  const preheader = isEs
    ? 'Recibimos tu solicitud — Michał te contactará en 24-48h por WhatsApp.'
    : 'We got your application — Michał will reach out within 24-48h on WhatsApp.';

  const bodyHtml = isEs
    ? `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">¡Bienvenido al programa Founding 50!</h1>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        Hola ${escapeHtml(firstName(args.fullName))} —
      </p>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        Recibimos tu solicitud para ser uno de los <strong>50 agentes fundadores</strong> de AHO. Gracias por confiar en una plataforma en sus primeros días — eso significa mucho.
      </p>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        <strong>Qué pasa ahora:</strong> te escribo personalmente por WhatsApp en las próximas 24-48 horas para conocerte, entender tu mercado en ${escapeHtml(args.city)}, y mostrarte AHO en vivo. No hay presión ni venta — es una conversación.
      </p>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        <strong>Lo que tienes garantizado al entrar:</strong>
      </p>
      <ul style="margin:0 0 20px 20px;padding:0;color:${COLORS.inkMuted};">
        <li style="margin:0 0 6px;">Tarifa de fundador <strong>permanente</strong> — no cambia cuando lancemos al público.</li>
        <li style="margin:0 0 6px;">Acceso directo a mí (Michał) por WhatsApp para feedback y soporte.</li>
        <li style="margin:0 0 6px;">Tu voz cuenta en qué construimos a continuación.</li>
      </ul>
      ${args.whatsappDisplay
        ? `<p style="margin:0 0 20px;color:${COLORS.helper};font-size:13px;">Te contactaré al WhatsApp <strong style="color:${COLORS.ink};">${escapeHtml(args.whatsappDisplay)}</strong>. Si es incorrecto, simplemente responde a este correo con el número correcto.</p>`
        : `<p style="margin:0 0 20px;color:${COLORS.helper};font-size:13px;">Si prefieres WhatsApp en lugar de email, simplemente responde con tu número.</p>`}
      ${buttonPrimary(escapeHtml(args.programUrl), 'Ver el programa Founding 50')}
      <p style="margin:32px 0 0;color:${COLORS.helper};font-size:13px;">
        Saludos,<br/>
        Michał Babula<br/>
        <span style="color:${COLORS.inkMuted};">Fundador, Advertise Homes Online</span>
      </p>`
    : `
      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">Welcome to the Founding 50 program!</h1>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        Hi ${escapeHtml(firstName(args.fullName))} —
      </p>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        We received your application to be one of the <strong>50 founding agents</strong> on AHO. Thanks for trusting an early-days platform — it means a lot.
      </p>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        <strong>What happens next:</strong> I'll personally reach out on WhatsApp within the next 24-48 hours to get to know you, understand your market in ${escapeHtml(args.city)}, and walk you through AHO live. No pressure, no pitch — just a conversation.
      </p>
      <p style="margin:0 0 16px;color:${COLORS.inkMuted};">
        <strong>What you're locking in:</strong>
      </p>
      <ul style="margin:0 0 20px 20px;padding:0;color:${COLORS.inkMuted};">
        <li style="margin:0 0 6px;"><strong>Permanent</strong> founder rate — doesn't change when we go public.</li>
        <li style="margin:0 0 6px;">Direct WhatsApp access to me (Michał) for feedback + support.</li>
        <li style="margin:0 0 6px;">Your voice on what we build next.</li>
      </ul>
      ${args.whatsappDisplay
        ? `<p style="margin:0 0 20px;color:${COLORS.helper};font-size:13px;">I'll reach you on WhatsApp at <strong style="color:${COLORS.ink};">${escapeHtml(args.whatsappDisplay)}</strong>. If that's wrong, just reply to this email with the right number.</p>`
        : `<p style="margin:0 0 20px;color:${COLORS.helper};font-size:13px;">If you'd rather WhatsApp than email, just reply with your number.</p>`}
      ${buttonPrimary(escapeHtml(args.programUrl), 'See the Founding 50 program')}
      <p style="margin:32px 0 0;color:${COLORS.helper};font-size:13px;">
        Best,<br/>
        Michał Babula<br/>
        <span style="color:${COLORS.inkMuted};">Founder, Advertise Homes Online</span>
      </p>`;

  const html = emailLayout({ preheader, bodyHtml });

  const text = isEs
    ? [
        `Hola ${firstName(args.fullName)},`,
        '',
        'Recibimos tu solicitud para ser uno de los 50 agentes fundadores de AHO.',
        '',
        `Te contactaré personalmente por WhatsApp en las próximas 24-48 horas para conocerte y mostrarte AHO en vivo. Sin presión.`,
        '',
        'Garantizado al entrar:',
        '- Tarifa de fundador permanente',
        '- Acceso directo a mí (Michał) por WhatsApp',
        '- Tu voz en lo que construimos',
        '',
        `Programa: ${args.programUrl}`,
        '',
        'Saludos,',
        'Michał Babula',
        'Fundador, Advertise Homes Online',
      ].join('\n')
    : [
        `Hi ${firstName(args.fullName)},`,
        '',
        'We received your application to be one of the 50 founding agents on AHO.',
        '',
        `I'll reach out personally on WhatsApp within 24-48 hours to get to know you and walk you through AHO live. No pressure.`,
        '',
        "What you're locking in:",
        '- Permanent founder rate',
        '- Direct WhatsApp access to me (Michał)',
        '- Your voice on what we build next',
        '',
        `Program: ${args.programUrl}`,
        '',
        'Best,',
        'Michał Babula',
        'Founder, Advertise Homes Online',
      ].join('\n');

  return { subject, html, text };
}
