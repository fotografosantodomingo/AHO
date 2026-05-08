import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';
import { getCountryName } from '@/lib/i18n/countries';
import { getCountryCities } from '@/lib/listings/countries';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO — country landing';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface PageParams {
  locale: string;
  country: string;
}

export default async function OgImage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, country } = await params;
  const isEs = locale === 'es' && LOCALES.includes(locale as Locale);
  const typedLocale: Locale = isEs ? 'es' : 'en';
  const cc = country.toUpperCase();
  const fonts = await interBoldFontEntry();

  // Defensive: bad ISO code → fall through to a generic AHO card.
  if (!/^[A-Z]{2}$/.test(cc)) {
    return new ImageResponse(<GenericFallback />, { ...size, fonts });
  }

  const display = getCountryName(cc, typedLocale);
  const result = await getCountryCities(cc).catch(() => null);
  const cityCount = result?.cities.length ?? 0;
  const listingCount = result
    ? result.cities.reduce((sum, c) => sum + c.listingCount, 0)
    : 0;

  const eyebrow = isEs ? 'Inmuebles en' : 'Properties in';
  const stats =
    cityCount > 0
      ? isEs
        ? `${cityCount} ciudades · ${listingCount} anuncios`
        : `${cityCount} cities · ${listingCount} listings`
      : isEs
        ? 'Próximamente — sé el primer agente'
        : 'Coming soon — be the first agent';

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
              fontSize: 96,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              maxWidth: 1040,
              color: '#ffffff',
            }}
          >
            {display.length > 28 ? display.slice(0, 26) + '…' : display}
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: '#d5d7db',
              marginTop: 24,
            }}
          >
            {stats}
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

function GenericFallback() {
  return (
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
  );
}
