import { emailLayout, escapeHtml, buttonPrimary, buttonSecondary, softBlock, COLORS } from './_layout';

/**
 * Day-60 expired email for the $5 private-owner listing.
 *
 * Sent by the daily expiry cron (`/api/cron/listing-expiry`) the same
 * pass that flips `properties.status` from `active` to `expired`.
 * Idempotency: the cron checks + stamps
 * `listing_purchases.expired_email_sent_at`, so each purchase row
 * receives at most one expired email regardless of how many times the
 * cron runs.
 *
 * Voice: matter-of-fact + offers a clear path back. Two CTAs:
 *   1. Primary  — reactivate the existing listing for another $5
 *      (re-uses the same `/api/sell/private/renew/{propertyId}` GET
 *      endpoint as the renewal-reminder email; that endpoint creates
 *      a fresh Checkout Session + 302s to Stripe).
 *   2. Secondary — upgrade to the Agent tier (the upsell — agents get
 *      unlimited listings + automation).
 *
 * The listing is NOT deleted on expiry — only `status` flips. The
 * property + photos stay in the DB so a reactivation is a single
 * Stripe Checkout completion away (no re-upload, no re-keying).
 */

interface ListingExpiredArgs {
  buyerName: string | null;
  propertyTitle: string;
  propertyUrl: string;
  /** ISO date string of the expiry — rendered as a localized date. */
  expiredAt: string;
  /** GET endpoint that creates a new $5 Checkout Session. */
  reactivateUrl: string;
  /** Localized link to /pricing (or /sell) for the agent-tier upsell. */
  upgradeUrl: string;
  locale: 'en' | 'es';
}

interface RenderedEmail {
  subject: string;
  html: string;
}

function formatDate(iso: string, locale: 'en' | 'es'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Use a stable Intl formatter — Edge runtime supports en-US + es-ES.
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

export function renderListingExpiredEmail(args: ListingExpiredArgs): RenderedEmail {
  const isEs = args.locale === 'es';
  const dateStr = formatDate(args.expiredAt, args.locale);

  const subject = isEs
    ? `Tu anuncio en AHO ha expirado`
    : `Your AHO listing has expired`;

  const greeting = isEs
    ? `Hola ${args.buyerName ?? ''},`.trim().replace(/,$/, '') + ','
    : `Hi ${args.buyerName ?? 'there'},`;

  const intro = isEs
    ? `Tu anuncio <strong>${escapeHtml(args.propertyTitle)}</strong> expiró el ${escapeHtml(dateStr)}. Puedes reactivarlo por otros 60 días con un solo pago de $5, o cambiar al plan de Agente para renovaciones ilimitadas.`
    : `Your listing <strong>${escapeHtml(args.propertyTitle)}</strong> expired on ${escapeHtml(dateStr)}. You can reactivate it for another 60 days with a single $5 payment, or upgrade to an Agent plan for unlimited renewals.`;

  const notDeletedTitle = isEs
    ? 'Tu propiedad sigue guardada'
    : 'Your property is still saved';
  const notDeletedBody = isEs
    ? `No hemos borrado nada: tu título, descripción y fotos siguen en AHO. En cuanto completes el pago de $5, tu anuncio vuelve a estar publicado de inmediato.`
    : `Nothing has been deleted: your title, description, and photos are still in AHO. Once the $5 payment completes, your listing goes back live immediately.`;

  const reactivateLabel = isEs ? 'Reactivar por $5' : 'Reactivate for $5';
  const upgradeLabel = isEs ? 'Plan de Agente' : 'See Agent plans';

  const bodyHtml = `
    <p style="margin:0 0 16px;color:${COLORS.ink};font-weight:600;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 20px;color:${COLORS.inkMuted};">${intro}</p>
    ${softBlock(
      `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${COLORS.helper};margin-bottom:6px;">${escapeHtml(notDeletedTitle)}</div>
       <div style="color:${COLORS.ink};">${notDeletedBody}</div>`,
    )}
    <div style="margin-top:24px;">
      ${buttonPrimary(args.reactivateUrl, reactivateLabel)}
      ${buttonSecondary(args.upgradeUrl, upgradeLabel)}
    </div>
    <p style="margin:20px 0 0;font-size:13px;color:${COLORS.helper};">
      <a href="${escapeHtml(args.propertyUrl)}" style="color:${COLORS.brand};text-decoration:underline;font-weight:600;">${isEs ? 'Ver el anuncio en AHO' : 'View the listing on AHO'}</a>
    </p>`;

  const preheader = isEs
    ? `${args.propertyTitle} expiró el ${dateStr}. Reactiva por $5.`
    : `${args.propertyTitle} expired on ${dateStr}. Reactivate for $5.`;

  const html = emailLayout({ preheader, bodyHtml });
  return { subject, html };
}
