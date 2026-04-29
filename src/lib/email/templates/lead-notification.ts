import { emailLayout, escapeHtml } from './_layout';

interface LeadNotificationArgs {
  agentName: string | null;
  propertyTitle: string;
  propertyCity: string;
  propertyPriceFormatted: string;
  /** Public URL to the listing detail page. */
  propertyUrl: string;
  /** Dashboard URL where the agent can act on the lead. */
  inboxUrl: string;
  source: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  message: string | null;
  /** ISO date string of the lead arrival. */
  receivedAt: string;
  /** Locale of the buyer who sent the lead — used to pick subject + body language. */
  locale: 'en' | 'es';
}

interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderLeadNotificationEmail(args: LeadNotificationArgs): RenderedEmail {
  const isEs = args.locale === 'es';
  const subject = isEs
    ? `Nuevo contacto: ${args.propertyTitle}`
    : `New lead: ${args.propertyTitle}`;

  const greetingName = args.agentName ?? (isEs ? 'Hola' : 'Hi');
  const greeting = isEs ? `Hola ${greetingName},` : `Hi ${greetingName},`;
  const intro = isEs
    ? `Acabas de recibir un nuevo contacto sobre tu propiedad <strong>${escapeHtml(
        args.propertyTitle,
      )}</strong> en ${escapeHtml(args.propertyCity)}.`
    : `You just received a new lead about your listing <strong>${escapeHtml(
        args.propertyTitle,
      )}</strong> in ${escapeHtml(args.propertyCity)}.`;

  const labels = isEs
    ? {
        from: 'De',
        email: 'Correo',
        phone: 'Teléfono',
        message: 'Mensaje',
        source: 'Origen',
        propertyHeading: 'Propiedad',
        viewProperty: 'Ver la propiedad',
        viewInbox: 'Abrir bandeja de contactos',
        anonymous: 'Contacto anónimo',
        priceLabel: 'Precio',
      }
    : {
        from: 'From',
        email: 'Email',
        phone: 'Phone',
        message: 'Message',
        source: 'Source',
        propertyHeading: 'Property',
        viewProperty: 'View the listing',
        viewInbox: 'Open the leads inbox',
        anonymous: 'Anonymous lead',
        priceLabel: 'Price',
      };

  const sourceLabel = (() => {
    switch (args.source) {
      case 'form':
        return isEs ? 'Formulario de contacto' : 'Contact form';
      case 'whatsapp_click':
        return 'WhatsApp';
      case 'phone_click':
        return isEs ? 'Clic en teléfono' : 'Phone click';
      case 'email_click':
        return isEs ? 'Clic en correo' : 'Email click';
      default:
        return args.source;
    }
  })();

  const rows: string[] = [];
  if (args.contactName) {
    rows.push(rowHtml(labels.from, escapeHtml(args.contactName)));
  } else {
    rows.push(rowHtml(labels.from, `<em>${labels.anonymous}</em>`));
  }
  if (args.contactEmail) {
    rows.push(
      rowHtml(
        labels.email,
        `<a href="mailto:${escapeHtml(args.contactEmail)}" style="color:#0e7490;">${escapeHtml(args.contactEmail)}</a>`,
      ),
    );
  }
  if (args.contactPhone) rows.push(rowHtml(labels.phone, escapeHtml(args.contactPhone)));
  rows.push(rowHtml(labels.source, escapeHtml(sourceLabel)));

  const messageBlock = args.message
    ? `<div style="margin-top:20px;padding:16px;background:#fafafa;border:1px solid #e4e4e7;border-radius:6px;">
         <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;margin-bottom:6px;">${labels.message}</div>
         <div style="white-space:pre-line;">${escapeHtml(args.message)}</div>
       </div>`
    : '';

  const propertyBlock = `
    <div style="margin-top:24px;padding-top:24px;border-top:1px solid #e4e4e7;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;margin-bottom:6px;">${labels.propertyHeading}</div>
      <div style="font-weight:500;">${escapeHtml(args.propertyTitle)}</div>
      <div style="color:#52525b;font-size:14px;margin-top:4px;">${escapeHtml(args.propertyCity)} · ${escapeHtml(
        args.propertyPriceFormatted,
      )}</div>
    </div>`;

  const ctas = `
    <div style="margin-top:24px;display:block;">
      <a href="${escapeHtml(args.inboxUrl)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:500;">${labels.viewInbox}</a>
      <a href="${escapeHtml(args.propertyUrl)}" style="display:inline-block;margin-left:8px;padding:10px 18px;border:1px solid #e4e4e7;color:#18181b;text-decoration:none;border-radius:6px;">${labels.viewProperty}</a>
    </div>`;

  const bodyHtml = `
    <p style="margin:0 0 16px;">${greeting}</p>
    <p style="margin:0 0 20px;">${intro}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
      ${rows.join('')}
    </table>
    ${messageBlock}
    ${propertyBlock}
    ${ctas}`;

  const html = emailLayout({
    preheader: isEs
      ? `${args.contactName ?? 'Alguien'} te contactó sobre ${args.propertyTitle}`
      : `${args.contactName ?? 'Someone'} contacted you about ${args.propertyTitle}`,
    bodyHtml,
  });

  return { subject, html };
}

function rowHtml(label: string, valueHtml: string): string {
  return `
    <tr>
      <td style="padding:6px 12px 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#71717a;width:110px;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;font-size:15px;vertical-align:top;">${valueHtml}</td>
    </tr>`;
}
