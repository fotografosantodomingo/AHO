import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` on script-src is required because (a) the layout's
 * theme-init script runs inline before hydration to prevent FOUC and (b)
 * Next.js's RSC payload bootstrap is inlined. CSP nonces would let us drop
 * 'unsafe-inline' but require per-request middleware nonce generation —
 * a future polish item.
 *
 * Allow-listed externals:
 *   - script-src: js.stripe.com (Stripe Checkout / Elements)
 *   - style-src: unpkg.com (Leaflet + leaflet.markercluster CSS via <link>)
 *   - img-src: imagedelivery.net (Cloudflare Images), *.tile.openstreetmap.org (Leaflet tiles)
 *   - connect-src: *.supabase.co (auth + db), api.stripe.com (server-side calls go through us; this is for any browser-side Stripe SDK), api.brevo.com (no, our wrapper runs server-side; can drop)
 *   - frame-src: js.stripe.com (3DS challenge iframes)
 *   - frame-ancestors 'none' = X-Frame-Options DENY equivalent (clickjacking guard)
 */
const csp = [
  "default-src 'self'",
  // js.stripe.com — Checkout/Elements; challenges.cloudflare.com — Turnstile
  // bot challenge widget script.
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  // Cloudflare R2 public dev URL (pub-<hash>.r2.dev) — fallback image
  // host while Cloudflare Images is not yet configured. Once a custom
  // domain like images.advertisehomes.online is set up, the wildcard
  // r2.dev entry can come out.
  "img-src 'self' data: blob: https://imagedelivery.net https://*.tile.openstreetmap.org https://*.r2.dev",
  "font-src 'self' data:",
  // api.pwnedpasswords.com — HIBP k-anonymity check on signup; never sees
  // the password (only first 5 chars of SHA-1 hash). Turnstile callbacks
  // are same-origin via the script.
  "connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.pwnedpasswords.com",
  // Stripe 3DS challenge iframe + Turnstile challenge iframe.
  "frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // upgrade-insecure-requests forces any http: subresources to https: at the
  // browser level — defense-in-depth on top of Cloudflare's HTTPS redirect.
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  {
    // 1 year, includeSubDomains, preload-eligible. Cloudflare also serves
    // HTTPS-redirect; HSTS ensures the browser never even tries plain HTTP.
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  {
    // Prevents MIME-sniffing attacks where browsers re-interpret a file
    // type (e.g. treating uploaded .txt as executable script).
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Anti-clickjacking belt-and-suspenders to CSP frame-ancestors.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Send full referrer to same-origin, only the origin to cross-origin
    // (no path leaks to outside hosts), no referrer at all on https→http
    // downgrades.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Block features we don't use by default. Geolocation might be
    // reintroduced for the search page's "near me" UX; revisit then.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
  },
  {
    key: 'Content-Security-Policy',
    value: csp,
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    typedRoutes: false, // re-enable once next-intl typed routes settle
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(config);
