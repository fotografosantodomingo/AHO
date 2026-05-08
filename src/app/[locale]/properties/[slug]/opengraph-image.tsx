import { ImageResponse } from 'next/og';
import { fetchPropertyByShortId, parseSlugParam } from '@/lib/listings/queries';
import { formatPrice } from '@/lib/listings/format';
import { LOCALES, type Locale } from '@/i18n/config';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO listing';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Per-property Open Graph image — surfaces title, price, and city
 * when an agent shares a listing on Twitter / WhatsApp / Facebook.
 *
 * Falls back to a generic AHO branded card if the slug doesn't
 * resolve (slug stale, listing archived, etc.) so the share never
 * breaks; just degrades gracefully.
 *
 * Edge-runtime compatible via @vercel/og (Satori-backed). No custom
 * font load — uses system sans-serif (custom-font fetches on Edge
 * have been finicky on Cloudflare Pages; system stack ships now).
 */

interface PageParams {
  locale: string;
  slug: string;
}

export default async function OgImage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  const isEs = locale === 'es' && LOCALES.includes(locale as Locale);
  const typedLocale: Locale = isEs ? 'es' : 'en';

  const parsed = parseSlugParam(slug);
  const [property, fonts] = await Promise.all([
    parsed
      ? fetchPropertyByShortId(parsed.shortId).catch(() => null)
      : Promise.resolve(null),
    interBoldFontEntry(),
  ]);

  // Fallback: generic AHO card when the listing can't be resolved.
  if (!property) {
    return new ImageResponse(
      (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: '#15181e',
            color: '#efeff1',
            fontFamily:
              '"Inter", system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
          }}
        >
          <div style={{ fontSize: 96, fontWeight: 700, color: '#ffffff' }}>AHO</div>
          <div style={{ fontSize: 28, color: '#d5d7db', marginTop: 16 }}>
            advertisehomes.online
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const title =
    (typedLocale === 'es' ? property.titleEs : property.titleEn) ??
    property.titleEn ??
    property.titleEs ??
    'Listing';
  const priceLabel = formatPrice(property.priceCents, property.currency, typedLocale);
  const city = property.city;
  const country = property.countryCode;
  const transactionLabel = (() => {
    if (typedLocale === 'es') {
      return property.transactionType === 'sale'
        ? 'En venta'
        : property.transactionType === 'rent'
          ? 'En alquiler'
          : 'Alquiler temporal';
    }
    return property.transactionType === 'sale'
      ? 'For sale'
      : property.transactionType === 'rent'
        ? 'For rent'
        : 'Short-term rental';
  })();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          backgroundColor: '#15181e',
          color: '#efeff1',
          fontFamily:
            '"Inter", system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
        }}
      >
        {/* Top row: AHO wordmark + transaction strap */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 48,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#ffffff',
            }}
          >
            AHO
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.13em',
              color: '#656a76',
            }}
          >
            {transactionLabel} · {city}, {country}
          </div>
        </div>

        {/* Title + price */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              maxWidth: 1040,
              color: '#ffffff',
            }}
          >
            {title.length > 90 ? title.slice(0, 87) + '…' : title}
          </div>
          <div
            style={{
              fontSize: 56,
              fontWeight: 600,
              color: '#ffffff',
              marginTop: 24,
            }}
          >
            {priceLabel}
          </div>
        </div>

        {/* Bottom: domain */}
        <div
          style={{
            display: 'flex',
            fontSize: 22,
            fontWeight: 500,
            color: '#656a76',
          }}
        >
          advertisehomes.online
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
