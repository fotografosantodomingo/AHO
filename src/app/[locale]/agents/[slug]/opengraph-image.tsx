import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';
import { fetchAgentProfile } from '@/lib/listings/search';
import { getCountryName } from '@/lib/i18n/countries';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO — agent profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

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

  const [result, fonts] = await Promise.all([
    fetchAgentProfile({
      orgSlug: slug,
      locale: typedLocale,
    }).catch(() => null),
    interBoldFontEntry(),
  ]);

  // Stale slug or fixture → generic AHO card so the share doesn't break.
  if (!result?.org) {
    return new ImageResponse(<GenericFallback />, { ...size, fonts });
  }

  const orgName = result.org.name;
  const listingCount = result.listings.length;
  const hqCity = result.org.headquartersCity;
  const hqCountryCode = result.org.headquartersCountry;
  const hqCountry = hqCountryCode
    ? getCountryName(hqCountryCode, typedLocale)
    : null;

  const eyebrow = (() => {
    if (result.org.type === 'agency') {
      return isEs ? 'Agencia inmobiliaria' : 'Real estate agency';
    }
    if (result.org.type === 'expert') {
      return isEs ? 'Experto inmobiliario' : 'Real estate expert';
    }
    return isEs ? 'Agente inmobiliario' : 'Real estate agent';
  })();

  const hqLine = (() => {
    const parts = [hqCity, hqCountry].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  })();

  const listingsLine =
    listingCount > 0
      ? isEs
        ? `${listingCount} ${listingCount === 1 ? 'anuncio activo' : 'anuncios activos'}`
        : `${listingCount} active ${listingCount === 1 ? 'listing' : 'listings'}`
      : isEs
        ? 'Próximamente'
        : 'Coming soon';

  const stats = hqLine ? `${listingsLine} · ${hqLine}` : listingsLine;

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
              fontSize: 80,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              maxWidth: 1040,
              color: '#ffffff',
            }}
          >
            {orgName.length > 36 ? orgName.slice(0, 34) + '…' : orgName}
          </div>
          <div
            style={{
              fontSize: 30,
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
