import { ImageResponse } from 'next/og';
import { fetchPropertyByShortId, parseSlugParam } from '@/lib/listings/queries';
import { formatPrice } from '@/lib/listings/format';
import { getCountryName } from '@/lib/i18n/countries';
import { LOCALES, type Locale } from '@/i18n/config';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO listing';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Per-property Open Graph image — surfaces the listing's primary photo
 * (full-bleed) with a tasteful overlay (price, city, beds/baths/area,
 * AHO mark) when an agent shares a listing on Facebook / Instagram /
 * WhatsApp / Slack / Twitter.
 *
 * Photo source: Cloudflare Images `og` variant (1200×630 cropped),
 * resolved as `https://imagedelivery.net/<hash>/<cf_image_id>/og`. We
 * fetch the bytes server-side and inline them as a base64 data URI so
 * Satori can render them deterministically inside `<img src="…">` —
 * passing a remote URL works in some Satori builds but is flaky on
 * Cloudflare Edge, where cross-origin image fetches inside the renderer
 * occasionally time out.
 *
 * Fallback path (no property / no photo / fetch fails) keeps the
 * text-only HashiCorp-dark card so the OG never returns a broken image.
 *
 * Edge-runtime compatible via @vercel/og (Satori-backed). Inter Bold
 * (700) is loaded once per render from the same-origin static asset.
 */

interface PageParams {
  locale: string;
  slug: string;
}

/** CF Images variant we target. `og` is 1200×630 cropped per
 *  `docs/CLOUDFLARE_RESOURCES.md`. If the variant is missing in the
 *  account (which would surface as a 404), the fetch helper returns
 *  null and we degrade to the text-only fallback rather than render a
 *  broken background. */
const OG_IMAGE_VARIANT = 'og';

/**
 * Fetch the listing's primary-photo bytes from Cloudflare Images and
 * return them as a `data:image/jpeg;base64,…` URL ready for Satori.
 * Returns null if anything goes wrong (no hash configured, no primary
 * photo, network error, non-2xx response, etc.) — the caller falls back
 * to the text-only design.
 */
async function fetchPrimaryPhotoDataUrl(
  cfImageId: string,
): Promise<string | null> {
  const cfHash = process.env.NEXT_PUBLIC_CF_IMAGES_HASH;
  if (!cfHash) return null;
  try {
    const res = await fetch(
      `https://imagedelivery.net/${cfHash}/${cfImageId}/${OG_IMAGE_VARIANT}`,
    );
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    // CF Images delivers JPEG by default for the `og` variant; even if
    // a future variant tweak switches to WebP, browsers/social previews
    // accept whatever Satori embeds — but we keep the mime as jpeg
    // because Satori is most reliable with JPEG for raster <img>.
    const base64 = arrayBufferToBase64(buf);
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null;
  }
}

/** Edge-runtime-safe ArrayBuffer → base64. `Buffer` is not available in
 *  the Cloudflare Edge runtime by default, so we hand-roll via
 *  `btoa` + a binary string built in 32 KB chunks (avoids the
 *  `Maximum call stack size exceeded` you get from
 *  `String.fromCharCode(...new Uint8Array(buf))` on big buffers). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
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
  // Fetch property + font in parallel so the cold-path latency is
  // dominated by whichever is slowest (typically the DB round-trip).
  const [property, fonts] = await Promise.all([
    parsed
      ? fetchPropertyByShortId(parsed.shortId).catch(() => null)
      : Promise.resolve(null),
    interBoldFontEntry(),
  ]);

  // Only attempt the photo fetch once we have a confirmed property +
  // a primary image with a CF image id. Sequencing this after the
  // property fetch (rather than chaining into the Promise.all above)
  // avoids a wasted round-trip on the fallback path.
  const primaryImage = property?.images.find((img) => img.isPrimary)
    ?? property?.images[0]
    ?? null;
  const photoDataUrl =
    primaryImage?.cfImageId
      ? await fetchPrimaryPhotoDataUrl(primaryImage.cfImageId)
      : null;

  // Fallback: generic AHO card when the listing can't be resolved OR
  // we have no usable primary photo. Same dark HashiCorp card as before
  // — including price + city + transaction strap when the property
  // resolved but the photo didn't (still a useful preview, just no
  // hero photo).
  if (!property || !photoDataUrl) {
    return renderTextOnlyCard({
      property,
      typedLocale,
      fonts,
    });
  }

  const priceLabel = formatPrice(property.priceCents, property.currency, typedLocale);
  const city = property.city;
  const country = getCountryName(property.countryCode, typedLocale);
  const cityCountry = `${city}, ${country}`;

  // Compose the bottom-right metadata chip from whichever metrics the
  // listing actually has. Skip nulls rather than render "0" or "—".
  const chipParts: string[] = [];
  if (property.bedrooms != null) {
    chipParts.push(
      typedLocale === 'es'
        ? `${property.bedrooms} hab`
        : `${property.bedrooms} bd`,
    );
  }
  if (property.bathrooms != null) {
    // Bathrooms can be fractional (e.g. 2.5). Round to 1 decimal then
    // strip a trailing `.0` so we don't render "2.0 ba".
    const baths = Number(property.bathrooms.toFixed(1)).toString();
    chipParts.push(typedLocale === 'es' ? `${baths} baño` : `${baths} ba`);
  }
  if (property.areaSqm != null) {
    chipParts.push(`${Math.round(property.areaSqm)} m²`);
  }
  const chipLabel = chipParts.join(' · ');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          fontFamily:
            '"Inter", system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
        }}
      >
        {/* Full-bleed primary photo. Satori needs explicit width/height
            on <img> — we fill the canvas. `objectFit: cover` keeps the
            aspect ratio sane even though the `og` CF variant is already
            cropped to 1200×630. */}
        {/* eslint-disable-next-line jsx-a11y/alt-text -- Satori-only JSX
            (rendered to a single PNG by next/og); not part of the
            DOM tree, so alt-text wouldn't reach assistive tech. The
            outer `alt` export above is the social-card alt text. */}
        <img
          src={photoDataUrl}
          width={1200}
          height={630}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />

        {/* Darkening gradient — transparent at top, ~70% black at bottom
            — so the bottom-row text stays legible regardless of the
            photo's underlying brightness. Satori supports linear-gradient
            backgrounds on plain divs. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            backgroundImage:
              'linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0.55) 75%, rgba(0,0,0,0.78) 100%)',
          }}
        />

        {/* Top-right: AHO mark + domain. Soft scrim panel keeps the
            wordmark legible against bright sky / light facade photos. */}
        <div
          style={{
            position: 'absolute',
            top: 40,
            right: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 18px',
            borderRadius: 999,
            backgroundColor: 'rgba(21,24,30,0.72)',
            color: '#ffffff',
          }}
        >
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              color: '#ffffff',
            }}
          >
            AHO
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 500,
              color: '#d5d7db',
            }}
          >
            advertisehomes.online
          </div>
        </div>

        {/* Bottom-left: city/country line + price. Both sit on the dark
            half of the gradient so they read as white-on-dark. */}
        <div
          style={{
            position: 'absolute',
            left: 56,
            bottom: 52,
            display: 'flex',
            flexDirection: 'column',
            maxWidth: 820,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              color: '#ffffff',
              letterSpacing: '-0.005em',
              textShadow: '0 1px 2px rgba(0,0,0,0.45)',
            }}
          >
            {cityCountry}
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: '#ffffff',
              lineHeight: 1.05,
              letterSpacing: '-0.025em',
              marginTop: 8,
              textShadow: '0 2px 6px rgba(0,0,0,0.5)',
            }}
          >
            {priceLabel}
          </div>
        </div>

        {/* Bottom-right: beds/baths/area chip. Only renders when at
            least one metric is present (a totally-empty chip would look
            like a stray pill). */}
        {chipLabel.length > 0 && (
          <div
            style={{
              position: 'absolute',
              right: 56,
              bottom: 64,
              display: 'flex',
              alignItems: 'center',
              padding: '10px 18px',
              borderRadius: 999,
              backgroundColor: 'rgba(255,255,255,0.92)',
              color: '#15181e',
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: '-0.005em',
            }}
          >
            {chipLabel}
          </div>
        )}
      </div>
    ),
    { ...size, fonts },
  );
}

/**
 * Text-only fallback card. Two flavours:
 *   - Property resolved but no usable primary photo → still includes
 *     price / city / transaction strap (a useful preview).
 *   - Property didn't resolve at all (slug stale, etc.) → bare AHO
 *     wordmark + domain so the share never breaks visibly.
 *
 * Identical visual language as the previous text-only OG (HashiCorp
 * dark `#15181e`) so the brand reads consistent regardless of which
 * branch fires.
 */
function renderTextOnlyCard({
  property,
  typedLocale,
  fonts,
}: {
  property: Awaited<ReturnType<typeof fetchPropertyByShortId>> | null;
  typedLocale: Locale;
  fonts: Awaited<ReturnType<typeof interBoldFontEntry>>;
}) {
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
