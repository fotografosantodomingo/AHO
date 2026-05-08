import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO — Advertise Homes Online';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Locale-aware Open Graph image for the homepage. Generated dynamically
 * per request via Next.js's ImageResponse (Satori-backed; works on
 * Cloudflare Edge runtime via @vercel/og).
 *
 * Layout: dark `#15181e` background (HashiCorp dark hero) + AHO
 * wordmark + locale-correct headline. Static for now (no per-listing
 * data); per-property OG lives at `/properties/[slug]/opengraph-image`.
 *
 * Font: Inter Bold loaded at request time from `/fonts/inter-700.woff2`
 * (vendored in /public). The system sans-serif stack stays as a graceful
 * fallback if the font fetch fails — better to render an OK-looking
 * preview than to fail the whole OG-image route.
 */

interface PageParams {
  locale: string;
}

export default async function OgImage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale } = await params;
  const isEs = locale === 'es' && LOCALES.includes(locale as Locale);

  const headline = isEs
    ? 'Inmuebles reales,'
    : 'Real estate,';
  const headlineLine2 = isEs
    ? 'anuncios reales — donde sea'
    : 'real listings — anywhere';
  const tagline = isEs
    ? 'Encuentra inmuebles en cualquier ciudad. Publica anuncios con un clic en Facebook e Instagram.'
    : 'Find homes wherever you’re looking. List with one click to Facebook and Instagram.';

  const fonts = await interBoldFontEntry();

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
        {/* Top row: AHO wordmark + locale chip */}
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
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.13em',
              color: '#656a76',
              border: '1px solid #3b3d45',
              padding: '6px 14px',
              borderRadius: 999,
            }}
          >
            {isEs ? 'ES' : 'EN'}
          </div>
        </div>

        {/* Center: headline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              maxWidth: 1040,
              color: '#ffffff',
            }}
          >
            {headline}
          </div>
          <div
            style={{
              fontSize: 88,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              maxWidth: 1040,
              color: '#ffffff',
              marginTop: 4,
            }}
          >
            {headlineLine2}
          </div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 400,
              lineHeight: 1.4,
              maxWidth: 980,
              color: '#d5d7db',
              marginTop: 32,
            }}
          >
            {tagline}
          </div>
        </div>

        {/* Bottom row: domain */}
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
