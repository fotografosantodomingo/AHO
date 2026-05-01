import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';
import { getCountryName } from '@/lib/i18n/countries';
import { citySlugToQuery, searchCityLanding } from '@/lib/listings/search';

export const runtime = 'edge';
export const alt = 'AHO — city landing';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface PageParams {
  locale: string;
  country: string;
  city: string;
}

function unslugifyCity(slug: string): string {
  return citySlugToQuery(slug)
    .split(' ')
    .map((w) => (w.length > 0 ? (w[0] ?? '').toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export default async function OgImage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, country, city } = await params;
  const isEs = locale === 'es' && LOCALES.includes(locale as Locale);
  const typedLocale: Locale = isEs ? 'es' : 'en';
  const cc = country.toUpperCase();

  const result = await searchCityLanding({
    countryCode: cc,
    citySlug: city,
    locale: typedLocale,
    limit: 30,
  }).catch(() => null);

  // Prefer the canonical city name from the first matched listing; fall
  // back to the unslugified form when there are no listings yet.
  const cityDisplay = result?.resolvedCity ?? unslugifyCity(city);
  const countryDisplay = getCountryName(cc, typedLocale);
  const listingCount = result?.totalShown ?? 0;

  const eyebrow = isEs ? 'Inmuebles en' : 'Properties in';
  const stats =
    listingCount > 0
      ? isEs
        ? `${listingCount} ${listingCount === 1 ? 'anuncio activo' : 'anuncios activos'} · ${countryDisplay}`
        : `${listingCount} active ${listingCount === 1 ? 'listing' : 'listings'} · ${countryDisplay}`
      : isEs
        ? `${countryDisplay} · próximamente`
        : `${countryDisplay} · coming soon`;

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
            'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
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
            {cityDisplay.length > 28 ? cityDisplay.slice(0, 26) + '…' : cityDisplay}
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
    { ...size },
  );
}
