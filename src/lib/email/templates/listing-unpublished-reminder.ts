import { emailLayout, escapeHtml, buttonPrimary, softBlock, COLORS } from './_layout';

/**
 * "Finish your AHO listing — you've already paid" nudge.
 *
 * Sent by the daily expiry cron (`/api/cron/listing-expiry`) for
 * orphaned `listing_purchases` rows — i.e. someone paid $5 but never
 * completed the simplified create-listing form, so `property_id` is
 * still NULL. Target window: `paid_at` between 5 and 60 days ago
 * (lower bound so we wait long enough for the buyer to come back on
 * their own; upper bound so we don't email after the listing window
 * has already expired).
 *
 * Idempotency: the cron checks + stamps
 * `listing_purchases.unpublished_reminder_sent_at`, so each orphan
 * receives at most one nudge.
 *
 * Single CTA: takes them to `/sell/private/new` — the simplified
 * create form, which gates on a paid+unconsumed `listing_purchases`
 * row for the current user (matching the Track-C gate).
 */

interface UnpublishedReminderArgs {
  buyerName: string | null;
  /** ISO date string of the purchase expiry (paid_at + 60 days). */
  expiresAt: string;
  /** Localized link to `/sell/private/new` — the simplified form. */
  createUrl: string;
  locale: 'en' | 'es';
}

interface RenderedEmail {
  subject: string;
  html: string;
}

function formatDate(iso: string, locale: 'en' | 'es'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === 'es' ? 'es-ES' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

export function renderListingUnpublishedReminderEmail(
  args: UnpublishedReminderArgs,
): RenderedEmail {
  const isEs = args.locale === 'es';
  const dateStr = formatDate(args.expiresAt, args.locale);

  const subject = isEs
    ? `Termina tu anuncio en AHO — ya está pagado`
    : `Finish your AHO listing — you've already paid`;

  const greeting = isEs
    ? `Hola ${args.buyerName ?? ''},`.trim().replace(/,$/, '') + ','
    : `Hi ${args.buyerName ?? 'there'},`;

  const intro = isEs
    ? `Hace unos días pagaste $5 por un anuncio en AHO, pero aún no lo has publicado. Tu ventana de publicación se cierra el <strong>${escapeHtml(dateStr)}</strong> — vamos a dejar tu propiedad en línea.`
    : `A few days ago you paid $5 for an AHO listing but haven't published it yet. Your listing window closes on <strong>${escapeHtml(dateStr)}</strong> — let's get your property live.`;

  const whyTitle = isEs ? '¿Por qué publicar ahora?' : 'Why publish now?';
  const whyBody = isEs
    ? `Toma unos 5 minutos: subes fotos, escribes una descripción corta, y AHO traduce y publica en 7 idiomas automáticamente. Cuanto antes esté tu propiedad en línea, más días de exposición tendrás dentro del ciclo de 60 días.`
    : `It takes about 5 minutes: upload photos, write a short description, and AHO translates and publishes in 7 languages automatically. The sooner your property is live, the more exposure you get inside the 60-day window.`;

  const ctaLabel = isEs ? 'Crear mi anuncio ahora' : 'Create my listing now';

  const bodyHtml = `
    <p style="margin:0 0 16px;color:${COLORS.ink};font-weight:600;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 20px;color:${COLORS.inkMuted};">${intro}</p>
    ${softBlock(
      `<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:${COLORS.helper};margin-bottom:6px;">${escapeHtml(whyTitle)}</div>
       <div style="color:${COLORS.ink};">${whyBody}</div>`,
    )}
    <div style="margin-top:24px;">
      ${buttonPrimary(args.createUrl, ctaLabel)}
    </div>`;

  const preheader = isEs
    ? `Ya pagaste $5 — vamos a publicar tu propiedad antes del ${dateStr}.`
    : `You've already paid $5 — let's publish your property before ${dateStr}.`;

  const html = emailLayout({ preheader, bodyHtml });
  return { subject, html };
}
