import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO — countries directory';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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

  const eyebrow = isEs ? 'Explorar' : 'Browse';
  const headline = isEs ? 'Inmuebles en todo el mundo' : 'Real estate worldwide';
  const tagline = isEs
    ? 'Cada país con anuncios activos en AHO.'
    : 'Every country with active AHO listings.';

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
            {eyebrow}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
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
              fontSize: 26,
              fontWeight: 400,
              lineHeight: 1.4,
              maxWidth: 980,
              color: '#d5d7db',
              marginTop: 28,
            }}
          >
            {tagline}
          </div>
        </div>

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
