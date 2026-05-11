import { COLORS, emailLayout, escapeHtml } from './_layout';

interface DeviceVerificationArgs {
  /** First name or full name; falls back to "there" if empty. */
  recipientName: string | null;
  /** 6-digit code, already zero-padded. Rendered in a large monospace block. */
  code: string;
  /** Minutes until the code expires (display only). */
  expiresInMinutes: number;
  /** Best-effort UA summary for the attempt context line. */
  deviceLabel: string;
  /** Cloudflare-provided client IP. May be null in non-CF environments. */
  ip: string | null;
  /** Localized country name (already resolved upstream from cf-ipcountry). */
  countryName: string | null;
  /** Email body locale — bilingual EN/ES, narrowed upstream. */
  locale: 'en' | 'es';
}

interface RenderedEmail {
  subject: string;
  html: string;
}

/**
 * Sent when the sign-in flow detects a new device or an IP change on a
 * known device. The body shows a 6-digit verification code, the
 * attempt context (device + IP + country), and a "wasn't me?" line
 * pointing the user at the password-reset surface.
 *
 * Bilingual EN/ES (PL/PT/DE/FR/IT users get the EN copy via
 * narrowContentLocale upstream; the code itself is locale-agnostic).
 */
export function renderDeviceVerificationEmail(
  args: DeviceVerificationArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';
  const greetingName = (args.recipientName?.split(/\s+/)[0] ?? '').trim();

  const subject = isEs
    ? `${args.code} — código de verificación de AHO`
    : `${args.code} — your AHO verification code`;

  const greeting = greetingName
    ? isEs
      ? `Hola ${escapeHtml(greetingName)},`
      : `Hi ${escapeHtml(greetingName)},`
    : isEs
    ? 'Hola,'
    : 'Hi there,';

  const intro = isEs
    ? 'Detectamos un inicio de sesión desde un dispositivo o una ubicación nuevos. Por la seguridad de tu cuenta, confirma que eres tú introduciendo este código:'
    : "We noticed a sign-in from a new device or location. To keep your account safe, please confirm it's you by entering this code:";

  // Big bold code block. Letter-spacing widens the digits for at-a-glance
  // readability; tabular-nums style isn't reliable in webmail clients so
  // we use a fixed-width font stack.
  const codeBlock = `
    <div style="margin:24px 0;padding:20px;text-align:center;background:${COLORS.bandSoft};border:1px solid ${COLORS.cardBorder};border-radius:10px;">
      <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:0.32em;color:${COLORS.ink};">${escapeHtml(
        args.code,
      )}</div>
      <p style="margin:10px 0 0;font-size:12px;color:${COLORS.helper};">${
        isEs
          ? `El código caduca en ${args.expiresInMinutes} minutos.`
          : `This code expires in ${args.expiresInMinutes} minutes.`
      }</p>
    </div>`;

  // Attempt context. Country before IP because country alone is the more
  // meaningful "is this me?" signal; IP is for the technically-curious.
  const ctxRows: string[] = [
    `<tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;width:120px;">${
      isEs ? 'Dispositivo' : 'Device'
    }</td><td style="padding:6px 0;color:${COLORS.ink};font-size:13px;">${escapeHtml(
      args.deviceLabel,
    )}</td></tr>`,
  ];
  if (args.countryName) {
    ctxRows.push(
      `<tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">${
        isEs ? 'Ubicación' : 'Location'
      }</td><td style="padding:6px 0;color:${COLORS.ink};font-size:13px;">${escapeHtml(
        args.countryName,
      )}</td></tr>`,
    );
  }
  if (args.ip) {
    ctxRows.push(
      `<tr><td style="padding:6px 0;color:${COLORS.helper};font-size:13px;">IP</td><td style="padding:6px 0;color:${COLORS.ink};font-size:13px;font-family:'SF Mono',Menlo,Consolas,monospace;">${escapeHtml(
        args.ip,
      )}</td></tr>`,
    );
  }
  const ctxBlock = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;width:100%;">
      ${ctxRows.join('')}
    </table>`;

  // Standard "not you?" footer. Doesn't deep-link to the reset page —
  // the user should arrive there via the canonical sign-in surface,
  // not a click straight from email (defense against pixel-tracker
  // fingerprinting / clicky users).
  const notYou = isEs
    ? 'Si no fuiste tú quien intentó iniciar sesión, ignora este correo y, por seguridad, cambia tu contraseña en cuanto puedas.'
    : "If this wasn't you, ignore this email — and, for safety, change your password as soon as you can.";

  const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${COLORS.ink};">${greeting}</h1>
    <p style="margin:0 0 4px;color:${COLORS.inkMuted};">${intro}</p>
    ${codeBlock}
    ${ctxBlock}
    <p style="margin:0;color:${COLORS.helper};font-size:13px;">${notYou}</p>`;

  const html = emailLayout({
    preheader: isEs
      ? `Tu código de verificación: ${args.code}`
      : `Your verification code: ${args.code}`,
    bodyHtml,
  });

  return { subject, html };
}
