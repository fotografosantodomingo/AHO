import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';

export const runtime = 'edge';
export const alt = 'AHO pricing — plans built for working agents';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Locale-aware Open Graph image for the /pricing page. Same dark
 * HashiCorp-style hero as the homepage OG, but reframed around the
 * pricing pitch — better marketing share previews on Twitter / LinkedIn /
 * WhatsApp than inheriting the generic homepage card.
 *
 * Static (no per-customer data) and font-stack-only (no fetch) so it
 * stays edge-cheap. The price tile is hardcoded — `setup-stripe-products`
 * keeps Stripe in sync with these numbers; if pricing ever changes, this
 * file needs the matching update.
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

  const eyebrow = isEs ? 'Precios' : 'Pricing';
  const headline = isEs
    ? 'Planes hechos para agentes en acción.'
    : 'Plans built for working agents.';
  const tagline = isEs
    ? 'Mensual o anual. Distribución social en un clic. Cambios en cualquier momento.'
    : 'Monthly or annual. One-click social distribution. Switch any time.';
  const priceLabel = isEs ? 'Agente, mensual' : 'Agent, monthly';
  const founderLabel = isEs ? 'Tarifa fundadora' : 'Founder rate';
  const founderTail = isEs ? 'primeros 50 agentes' : 'first 50 agents';

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
        {/* Top row: AHO wordmark + Pricing eyebrow */}
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
            {eyebrow}
          </div>
        </div>

        {/* Center: headline + tagline */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 80,
              fontWeight: 700,
              lineHeight: 1.06,
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

        {/* Bottom row: price tile + domain */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#1c1f27',
              border: '1px solid #2b2f3a',
              borderRadius: 16,
              padding: '20px 28px',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.13em',
                color: '#656a76',
              }}
            >
              {priceLabel}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 14,
                marginTop: 6,
              }}
            >
              <div
                style={{
                  fontSize: 56,
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: '#ffffff',
                }}
              >
                $29
              </div>
              <div style={{ display: 'flex', fontSize: 18, color: '#a1a4ac' }}>
                /mo
              </div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#10b981',
                  marginLeft: 8,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                {founderLabel} · $19 · {founderTail}
              </div>
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
      </div>
    ),
    { ...size },
  );
}
