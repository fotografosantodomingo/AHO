import { emailLayout, escapeHtml, buttonPrimary, buttonSecondary, softBlock, COLORS } from './_layout';

/**
 * Day-55 renewal reminder for the $5 private-owner listing.
 *
 * Sent by the daily expiry cron (`/api/cron/listing-expiry`) once per
 * `listing_purchases` row that has a linked property whose `expires_at`
 * falls within the next 5 days. Idempotency: the cron checks +
 * stamps `listing_purchases.renewal_reminder_sent_at`, so each
 * purchase receives at most one renewal reminder during its 60-day
 * window.
 *
 * Voice: short, friendly, two CTAs. Primary = renew the listing for
 * another $5; secondary = upgrade to the Agent tier (the upsell —
 * Agent gets unlimited renewals + automation). The renew button
 * points at `/api/sell/private/renew/{propertyId}` which is a GET
 * endpoint that creates a new Stripe Checkout Session and 302s to
 * it — so the email button just works as a plain `<a href>`.
 *
 * Bilingual: EN + ES handwritten. Marketing locales (PL/PT/DE/FR/IT)
 * fall back to EN per the existing landing-page convention; the cron
 * passes `'en'` for any non-ES locale.
 *
 * Real-only data: the property title comes from `properties.title_en` /
 * `properties.title_es`. No demo / fixture data ever reaches this
 * template in production (CLAUDE.md hard rule #8 — empty states are
 * honest emptiness; this email isn't sent if there's no listing).
 */

interface RenewalReminderArgs {
  /** Display name of the buyer, falls back to a generic greeting when
   *  `profiles.full_name` is null. */
  buyerName: string | null;
  /** Listing title in the recipient's locale. */
  propertyTitle: string;
  /** Public URL to the listing detail page. */
  propertyUrl: string;
  /** Days remaining until expiry (typically 5). Rendered as `{n} days`. */
  daysRemaining: number;
  /** GET endpoint that creates a new $5 Checkout Session +
   *  302-redirects to Stripe. Plain `<a href>` from the email; no JS. */
  renewUrl: string;
  /** Localized link to /pricing (or /sell) for the agent-tier upsell. */
  upgradeUrl: string;
  /** Locale of the buyer — used to pick subject + body language. */
  locale: 'en' | 'es';
}

interface RenderedEmail {
  subject: string;
  html: string;
}

export function renderListingRenewalReminderEmail(
  args: RenewalReminderArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';

  const subject = isEs
    ? `Tu anuncio en AHO vence en ${args.daysRemaining} días — renueva por $5`
    : `Your AHO listing expires in ${args.daysRemaining} days — renew for $5`;

  const greeting = isEs
    ? `Hola ${args.buyerName ?? ''},`.trim().replace(/,$/, '') + ','
    : `Hi ${args.buyerName ?? 'there'},`;

  const intro = isEs
    ? `Tu anuncio <strong>${escapeHtml(args.propertyTitle)}</strong> vence en ${args.daysRemaining} días. Renuévalo por $5 y mantén tu propiedad publicada otros 60 días.`
    : `Your AHO listing <strong>${escapeHtml(args.propertyTitle)}</strong> expires in ${args.daysRemaining} days. Renew for $5 to keep your property live for another 60 days.`;

  const whatHappensTitle = isEs ? '¿Qué pasa si no renuevas?' : 'What happens if you don\'t renew?';
  const whatHappensBody = isEs
    ? `Tu anuncio cambiará a estado <em>expirado</em> automáticamente. Tu propiedad y sus fotos se conservan — podrás reactivarla en cualquier momento por $5, o cambiar al plan de Agente para renovaciones ilimitadas.`
    : `Your listing will automatically switch to <em>expired</em>. Your property and photos are kept — you can reactivate any time for $5, or upgrade to an Agent plan for unlimited renewals.`;

  const renewLabel = isEs ? 'Renovar por $5' : 'Renew for $5';
  const upgradeLabel = isEs
    ? 'O cambia al plan de Agente'
    : 'Or upgrade to an Agent plan';

  const viewListingLabel = isEs ? 'Ver el anuncio' : 'View the listing';

  const bodyHtml = `
    <p style="margin:0 0 16px;color:${COLORS.ink};font-weight:600;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 20px;color:${COLORS.inkMuted};">${intro}</p>
    ${softBlock(
      `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${COLORS.helper};margin-bottom:6px;">${escapeHtml(whatHappensTitle)}</div>
       <div style="color:${COLORS.ink};">${whatHappensBody}</div>`,
    )}
    <div style="margin-top:24px;">
      ${buttonPrimary(args.renewUrl, renewLabel)}
      ${buttonSecondary(args.propertyUrl, viewListingLabel)}
    </div>
    <p style="margin:20px 0 0;font-size:13px;color:${COLORS.helper};">
      ${escapeHtml(upgradeLabel)} —
      <a href="${escapeHtml(args.upgradeUrl)}" style="color:${COLORS.brand};text-decoration:underline;font-weight:600;">${isEs ? 'renovaciones ilimitadas' : 'unlimited renewals'}</a>.
    </p>`;

  const preheader = isEs
    ? `Tu propiedad ${args.propertyTitle} vence pronto.`
    : `Your listing for ${args.propertyTitle} expires soon.`;

  const html = emailLayout({ preheader, bodyHtml });
  return { subject, html };
}
