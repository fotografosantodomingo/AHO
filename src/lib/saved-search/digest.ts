/**
 * Pure render helpers for the saved-search digest email.
 *
 * Lives in src/ (not workers/) so:
 *   - the standalone Cloudflare Worker (workers/saved-search-alerts)
 *     imports it relatively via ../../src/lib/saved-search/digest;
 *   - vitest can import it through the @/ alias without dragging
 *     @cloudflare/workers-types into the main app's typecheck.
 *
 * Don't add side effects, fetch calls, or runtime-specific globals here.
 * Anything that needs Cloudflare/Node APIs goes in the worker entrypoint.
 */

export interface DigestProperty {
  id: string;
  short_id: string;
  slug_en: string | null;
  slug_es: string | null;
  title_en: string | null;
  title_es: string | null;
  city: string;
  country_code: string;
  price_cents: number | string;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | string | null;
  area_sqm: number | string | null;
  transaction_type: string;
  published_at: string;
}

export interface RenderDigestArgs {
  recipientName: string | null;
  savedSearchName: string | null;
  savedSearchId: string;
  locale: 'en' | 'es';
  matches: DigestProperty[];
  siteUrl: string;
}

export interface DigestOutput {
  subject: string;
  html: string;
}

export function renderDigest(args: RenderDigestArgs): DigestOutput {
  const isEs = args.locale === 'es';
  const greeting = args.recipientName
    ? isEs
      ? `Hola ${escape(args.recipientName)},`
      : `Hi ${escape(args.recipientName)},`
    : isEs
    ? '¡Hola!'
    : 'Hi there,';

  const subject = isEs
    ? `${args.matches.length} ${args.matches.length === 1 ? 'nuevo anuncio' : 'nuevos anuncios'} para ${args.savedSearchName ? `"${args.savedSearchName}"` : 'tu búsqueda guardada'}`
    : `${args.matches.length} new ${args.matches.length === 1 ? 'listing' : 'listings'} for ${args.savedSearchName ? `"${args.savedSearchName}"` : 'your saved search'}`;

  const intro = isEs
    ? args.savedSearchName
      ? `Tu búsqueda guardada "${escape(args.savedSearchName)}" tiene ${args.matches.length} ${args.matches.length === 1 ? 'nuevo resultado' : 'nuevos resultados'}.`
      : `Tu búsqueda guardada tiene ${args.matches.length} ${args.matches.length === 1 ? 'nuevo resultado' : 'nuevos resultados'}.`
    : args.savedSearchName
    ? `Your saved search "${escape(args.savedSearchName)}" has ${args.matches.length} new ${args.matches.length === 1 ? 'match' : 'matches'}.`
    : `Your saved search has ${args.matches.length} new ${args.matches.length === 1 ? 'match' : 'matches'}.`;

  const dashboardPath = isEs ? 'busquedas-guardadas' : 'saved-searches';
  const dashboardUrl = `${args.siteUrl}/${args.locale}/${dashboardPath}`;
  const propertyPath = isEs ? 'propiedades' : 'properties';

  const cards = args.matches
    .map((m) => {
      const slug = isEs ? m.slug_es ?? m.slug_en : m.slug_en ?? m.slug_es;
      const title = (isEs ? m.title_es : m.title_en) ?? m.title_en ?? m.title_es ?? '—';
      const href = slug
        ? `${args.siteUrl}/${args.locale}/${propertyPath}/${slug}-${m.short_id}`
        : args.siteUrl;
      const priceFmt = formatPriceCents(Number(m.price_cents), m.currency, args.locale);
      const beds = m.bedrooms
        ? ` · ${m.bedrooms} ${
            isEs ? (m.bedrooms === 1 ? 'hab.' : 'habs.') : m.bedrooms === 1 ? 'bed' : 'beds'
          }`
        : '';
      const sqm = m.area_sqm ? ` · ${Number(m.area_sqm)} m²` : '';
      return `
        <tr><td style="padding:16px 0;border-bottom:1px solid #e6e7e9">
          <a href="${escape(href)}" style="color:#1d2027;text-decoration:none;display:block">
            <div style="font:600 16px/1.3 system-ui, -apple-system, Segoe UI, sans-serif;color:#1d2027">${escape(title)}</div>
            <div style="font:400 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif;color:#656a76;margin-top:4px">
              ${escape(m.city)}, ${escape(m.country_code)}${beds}${sqm}
            </div>
            <div style="font:600 15px/1.3 system-ui, -apple-system, Segoe UI, sans-serif;color:#059669;margin-top:6px">${priceFmt}</div>
          </a>
        </td></tr>`;
    })
    .join('');

  const footer = isEs
    ? `Para dejar de recibir alertas para esta búsqueda, abre el <a href="${escape(dashboardUrl)}" style="color:#2264d6">panel de búsquedas guardadas</a>.`
    : `To stop receiving alerts for this saved search, open your <a href="${escape(dashboardUrl)}" style="color:#2264d6">saved-searches dashboard</a>.`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,sans-serif">
<table cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#f6f7f9;padding:32px 16px"><tr><td align="center">
<table cellspacing="0" cellpadding="0" border="0" width="600" style="background:#ffffff;border-radius:12px;padding:32px;max-width:600px">
  <tr><td style="font:700 22px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2027">AHO</td></tr>
  <tr><td style="padding-top:16px;font:400 16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2027">${greeting}</td></tr>
  <tr><td style="padding-top:8px;font:400 16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2027">${intro}</td></tr>
  <tr><td><table cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:16px">${cards}</table></td></tr>
  <tr><td style="padding-top:24px;font:400 13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#656a76">${footer}</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html };
}

export function formatPriceCents(cents: number, currency: string, locale: 'en' | 'es'): string {
  try {
    return new Intl.NumberFormat(locale === 'es' ? 'es-DO' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(0)}`;
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
