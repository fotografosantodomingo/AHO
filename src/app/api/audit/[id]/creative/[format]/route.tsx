import { ImageResponse } from 'next/og';
import { createAdminClient } from '@/lib/supabase/admin';
import { interBoldFontEntry } from '@/lib/og/load-font';
import { formatPrice } from '@/lib/listings/format';
import type { ImportedFacts } from '@/lib/listings/import-from-url';

export const runtime = 'edge';

/**
 * GET /api/audit/[id]/creative/[format]
 *
 * Phase 2 of docs/SUPER_PRO_STAGE_1_PLAN.md — Creative Factory v1.
 * Returns a per-platform PNG rendered on-demand from an ai_audits
 * row + one hero photo from the imported listing.
 *
 * Formats:
 *   - fb   → 1200×630  (Facebook feed share, also fine for LinkedIn)
 *   - ig   → 1080×1080 (Instagram square feed post)
 *   - pin  → 1000×1500 (Pinterest vertical pin)
 *
 * Layout common to all three:
 *   - Source hero photo as the visual backdrop
 *   - Listing title, price chip, city overlay on a dark scrim so the
 *     text reads regardless of photo brightness
 *   - "Powered by AHO" footer bar per docs/DECISIONS.md 2026-05-17 —
 *     wordmark + advertisehomes.online on the accent-color band,
 *     guaranteed-visible attribution every time the agent publishes.
 *
 * Backed by Next.js `next/og` (Satori + resvg-wasm), same primitive
 * the existing opengraph-image.tsx routes use. No new dependency.
 *
 * Caching: 1-hour edge cache via Cache-Control. The image is a pure
 * function of the audit row + format, and audits are immutable once
 * inserted, so we could go further (immutable 1y) — but a 1h ceiling
 * lets us hotfix template bugs without invalidating every prior URL.
 *
 * Failure mode: any error renders a graceful fallback PNG with the
 * AHO brand mark, so the preview page never shows a broken-image
 * icon even if the hero photo fetch times out on a slow portal CDN.
 */

const FORMATS = {
  fb: { width: 1200, height: 630 },
  ig: { width: 1080, height: 1080 },
  pin: { width: 1000, height: 1500 },
} as const;

type Format = keyof typeof FORMATS;

const ACTION_GREEN = '#2c4d3a';
const SCRIM = 'rgba(0,0,0,0.55)';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format: formatRaw } = await ctx.params;
  const format = (FORMATS[formatRaw as Format] ? (formatRaw as Format) : 'fb');
  const size = FORMATS[format];

  // Load audit row. Public SELECT is allowed by RLS anyway; admin
  // client just bypasses the policy on every render for consistency
  // with /preview/[id]'s SSR path.
  const admin = createAdminClient();
  const { data: audit } = await admin
    .from('ai_audits')
    .select('facts')
    .eq('id', id)
    .maybeSingle();

  const fonts = await interBoldFontEntry();

  if (!audit) {
    return renderFallback(size, 'Audit not found', fonts);
  }

  const facts = audit.facts as ImportedFacts;
  const title =
    facts.titleEn ?? facts.titleEs ?? 'Listing';
  const priceLabel =
    facts.priceCents && facts.priceCents > 0 && facts.currency
      ? formatPrice(facts.priceCents, facts.currency, 'en')
      : null;
  const cityLabel = [facts.city, facts.countryCode].filter(Boolean).join(', ');
  const photoUrl = pickHeroPhoto(facts.photoUrls ?? []);

  try {
    return new ImageResponse(
      (
        <Layout
          size={size}
          format={format}
          title={title}
          priceLabel={priceLabel}
          cityLabel={cityLabel}
          photoUrl={photoUrl}
        />
      ),
      {
        ...size,
        fonts,
        headers: {
          'cache-control': 'public, max-age=3600, immutable',
        },
      },
    );
  } catch (err) {
    console.error('[creative] render failed', err);
    return renderFallback(size, title, fonts);
  }
}

function pickHeroPhoto(urls: string[]): string | null {
  // First HTTPS-only URL; HTTP photos would either get mixed-content
  // blocked or proxy fetch issues on the edge worker. Source portals
  // serve HTTPS in 2026 with very few exceptions, so dropping HTTP is
  // safe and avoids a rendering failure path.
  return urls.find((u) => u.startsWith('https://')) ?? null;
}

function Layout({
  size,
  format,
  title,
  priceLabel,
  cityLabel,
  photoUrl,
}: {
  size: { width: number; height: number };
  format: Format;
  title: string;
  priceLabel: string | null;
  cityLabel: string;
  photoUrl: string | null;
}) {
  // Photo placement varies by aspect:
  //  - fb (landscape) → photo left 58%, text right 42%
  //  - ig (square)    → photo top 68%, text bottom 32%
  //  - pin (vertical) → photo top 60%, text bottom 40%
  // Footer band is consistent: bottom 10% of canvas height.
  const footerH = Math.round(size.height * 0.1);
  const isLandscape = format === 'fb';

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#15181e',
        color: '#efeff1',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Body — photo + overlay text */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: isLandscape ? 'row' : 'column',
        }}
      >
        {/* Photo half */}
        <div
          style={{
            width: isLandscape ? '58%' : '100%',
            height: isLandscape ? '100%' : (format === 'ig' ? '68%' : '60%'),
            backgroundColor: '#0d1014',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt=""
              width="100%"
              height="100%"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
          ) : (
            <span style={{ fontSize: 64, opacity: 0.4 }}>🏠</span>
          )}
        </div>

        {/* Text half */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: isLandscape ? '64px 56px' : '40px 56px',
            backgroundColor: isLandscape ? '#1a1f27' : 'transparent',
            position: isLandscape ? 'static' : 'relative',
          }}
        >
          {/* Scrim for non-landscape: text sits over the bottom of the
              photo, so we draw a dark gradient band before rendering text.
              Simpler than CSS gradients in Satori: solid fill on the text panel. */}
          {!isLandscape && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                backgroundColor: SCRIM,
              }}
            />
          )}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            {cityLabel && (
              <div
                style={{
                  fontSize: format === 'pin' ? 26 : 22,
                  textTransform: 'uppercase',
                  letterSpacing: '0.12em',
                  color: '#9aa3af',
                  fontWeight: 700,
                }}
              >
                📍 {cityLabel}
              </div>
            )}
            <div
              style={{
                fontSize: format === 'fb' ? 48 : format === 'ig' ? 56 : 60,
                fontWeight: 700,
                lineHeight: 1.1,
                display: 'block',
              }}
            >
              {truncate(title, format === 'fb' ? 90 : 70)}
            </div>
            {priceLabel && (
              <div
                style={{
                  marginTop: 8,
                  display: 'flex',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
                  padding: '12px 20px',
                  backgroundColor: ACTION_GREEN,
                  color: '#ffffff',
                  fontSize: format === 'fb' ? 36 : 44,
                  fontWeight: 700,
                  borderRadius: 12,
                }}
              >
                {priceLabel}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer bar — "Powered by AHO" per DECISIONS.md 2026-05-17 */}
      <div
        style={{
          height: footerH,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 48px',
          backgroundColor: ACTION_GREEN,
          color: '#ffffff',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 14,
            fontSize: Math.round(footerH * 0.42),
            fontWeight: 700,
          }}
        >
          <span>AHO</span>
          <span style={{ opacity: 0.75, fontSize: Math.round(footerH * 0.26) }}>
            Advertise Homes Online
          </span>
        </div>
        <div
          style={{
            fontSize: Math.round(footerH * 0.28),
            opacity: 0.8,
          }}
        >
          advertisehomes.online
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function renderFallback(
  size: { width: number; height: number },
  label: string,
  fonts: Awaited<ReturnType<typeof interBoldFontEntry>>,
): Response {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#15181e',
          color: '#efeff1',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div style={{ fontSize: 72, fontWeight: 700 }}>AHO</div>
        <div
          style={{
            marginTop: 16,
            fontSize: 28,
            opacity: 0.65,
            display: 'block',
          }}
        >
          {label}
        </div>
      </div>
    ),
    {
      ...size,
      fonts,
      headers: { 'cache-control': 'public, max-age=300' },
    },
  );
}
