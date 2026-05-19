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
 *   - style-src: (none) — Leaflet CSS is now self-hosted under /leaflet/*
 *     so 'self' covers it; the unpkg.com allowance is gone
 *   - img-src: imagedelivery.net (Cloudflare Images), *.tile.openstreetmap.org (Leaflet tiles)
 *   - connect-src: *.supabase.co (auth + db), api.stripe.com (server-side calls go through us; this is for any browser-side Stripe SDK), api.brevo.com (no, our wrapper runs server-side; can drop)
 *   - frame-src: js.stripe.com (3DS challenge iframes)
 *   - frame-ancestors 'none' = X-Frame-Options DENY equivalent (clickjacking guard)
 */
const csp = [
  "default-src 'self'",
  // js.stripe.com — Checkout/Elements; challenges.cloudflare.com — Turnstile
  // bot challenge widget script.
  // embed.tawk.to + *.tawk.to — Tawk live-chat widget loader + runtime.
  "script-src 'self' 'unsafe-inline' https://js.stripe.com https://challenges.cloudflare.com https://embed.tawk.to https://*.tawk.to",
  "style-src 'self' 'unsafe-inline'",
  // Cloudflare R2 public dev URL (pub-<hash>.r2.dev) — fallback image
  // host while Cloudflare Images is not yet configured. Once a custom
  // domain like images.advertisehomes.online is set up, the wildcard
  // r2.dev entry can come out. Plus *.tawk.to + *.tawkcdn.com for
  // chat-agent avatars + widget icons.
  "img-src 'self' data: blob: https://imagedelivery.net https://*.tile.openstreetmap.org https://*.r2.dev https://*.tawk.to https://*.tawkcdn.com",
  "font-src 'self' data: https://*.tawk.to",
  // api.pwnedpasswords.com — HIBP k-anonymity check on signup; never sees
  // the password (only first 5 chars of SHA-1 hash). Turnstile callbacks
  // are same-origin via the script. Plus *.tawk.to + WSS for the live-
  // chat persistent connection.
  "connect-src 'self' https://*.supabase.co https://api.stripe.com https://api.pwnedpasswords.com https://*.tawk.to wss://*.tawk.to",
  // Service worker (PWA install). default-src 'self' would already cover
  // same-origin workers, but worker-src is the explicit directive Chrome
  // consults first, and PWA installability tooling (Lighthouse) lints
  // for it.
  "worker-src 'self'",
  // Stripe 3DS challenge iframe + Turnstile challenge iframe + Tawk
  // chat-window iframe.
  "frame-src https://js.stripe.com https://hooks.stripe.com https://challenges.cloudflare.com https://*.tawk.to",
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
  // REVERTED 2026-05-17 — `devIndicators: false` (commit 16f73e4) was
  // tree-shaking shared internals that `next/og` ImageResponse needs.
  // Symptom: every ImageResponse route (homepage OG, property OG,
  // /api/audit/[id]/creative/*) returned HTTP 200 + image/png + 0 bytes
  // in production. Reverting restores ImageResponse renders. The 600
  // KiB dev-overlay chunk comes back too — acceptable cost; the
  // creatives + OG pictures are user-facing, the dev overlay isn't.
  // Re-test bundle slimming via a different lever (e.g. modularize
  // imports, lazy-load) next time.
  // Production source maps OFF — re-disabled 2026-05-17 after the
  // dev-overlay investigation completed. Source maps shouldn't impact
  // runtime cost (only fetched when DevTools opens them) but Lighthouse
  // walks `sourceMappingURL` references and counts the maps toward
  // "Unused JavaScript" / network payload, inflating the reported
  // savings figure beyond reality. Flip back to true the next time
  // we need to identify the contents of a hashed chunk.
  productionBrowserSourceMaps: false,
  experimental: {
    typedRoutes: false, // re-enable once next-intl typed routes settle
    // Tree-shake barrel-file imports for these packages. Lighthouse
    // audit 2026-05-16 flagged ~30-50 KiB unused JS from full-bundle
    // imports of lucide-react, Supabase, react-hook-form helpers.
    // Next.js 15 rewrites `import { X } from 'pkg'` to per-module
    // imports at build time when the package is listed here.
    optimizePackageImports: [
      'lucide-react',
      '@supabase/supabase-js',
      '@supabase/ssr',
      '@hookform/resolvers',
      'leaflet',
      'react-leaflet',
      'date-fns',
    ],
    // Server Actions: explicitly allow the production + Pages preview
    // origins. Behind Cloudflare Pages the X-Forwarded-Host detection
    // sometimes drops the public hostname, and Next.js 15 default-
    // rejects Server Action POSTs whose Origin doesn't match the host
    // it sees → 404 + "An unexpected response was received from the
    // server" in the browser. Whitelisting both origins fixes it.
    serverActions: {
      allowedOrigins: [
        'advertisehomes.online',
        'aho-web.pages.dev',
        // Each preview deploy gets a unique <hash>.aho-web.pages.dev
        // subdomain. Wildcard accepts them all.
        '*.aho-web.pages.dev',
      ],
    },
  },
  async headers() {
    // X-Robots-Tag for every authed surface — defense-in-depth on top
    // of the 307→/signin auth gate. Crawlers shouldn't ever see the
    // dashboard HTML body (the gate redirects them), but if a session
    // cookie ever leaks (shared device, cached intermediary) the
    // header still tells the indexer "don't store this, don't show
    // snippets, don't cache." Covers EN slugs (/dashboard, /admin) and
    // ES alternates (/panel) plus the onboarding bounces.
    const noIndexHeader = [
      {
        key: 'X-Robots-Tag',
        value: 'noindex, nofollow, noarchive, nosnippet',
      },
    ];
    const authedPathGlobs = [
      '/dashboard/:path*',
      '/dashboard',
      '/panel/:path*',
      '/panel',
      '/admin/:path*',
      '/admin',
      '/setup-mfa',
      '/onboarding/:path*',
      '/inicio/:path*',
      '/preview/:path*',
      '/vista-previa/:path*',
      // next-intl prefixes every URL with /:locale — duplicate the
      // globs with a leading locale segment so /en/dashboard,
      // /pl/dashboard, etc. all pick up the header. The catch-all
      // `:locale(en|es|pl|pt|de|fr|it)` keeps non-locale URLs out.
      '/:locale(en|es|pl|pt|de|fr|it)/dashboard/:path*',
      '/:locale(en|es|pl|pt|de|fr|it)/dashboard',
      '/:locale(en|es|pl|pt|de|fr|it)/panel/:path*',
      '/:locale(en|es|pl|pt|de|fr|it)/panel',
      '/:locale(en|es|pl|pt|de|fr|it)/admin/:path*',
      '/:locale(en|es|pl|pt|de|fr|it)/admin',
      '/:locale(en|es|pl|pt|de|fr|it)/setup-mfa',
      '/:locale(en|es|pl|pt|de|fr|it)/onboarding/:path*',
      '/:locale(en|es|pl|pt|de|fr|it)/inicio/:path*',
      '/:locale(en|es|pl|pt|de|fr|it)/preview/:path*',
      '/:locale(en|es|pl|pt|de|fr|it)/vista-previa/:path*',
    ];
    // Cache-Control for the programmatic-SEO blog. The article body
    // is static once published (the cron writes ~every 2 days), so
    // we tell CF Pages to cache the rendered HTML at the edge for
    // 1 hour (s-maxage) while browsers keep a fresh copy for 5 min
    // (max-age). `stale-while-revalidate` lets the cache serve a
    // slightly-stale page instantly while async-fetching a fresh
    // render in the background. Drops LCP on subsequent loads from
    // ~1.1s (cold-render w/ Supabase) to <100ms (CDN cache HIT).
    //
    // Why not on the index page (/blog): index ordering can change
    // any time a new post lands; we let it stay default-uncached so
    // the most-recent post appears immediately after each publish.
    const blogCacheHeader = [
      {
        key: 'Cache-Control',
        value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      },
    ];
    const blogCacheGlobs = [
      '/blog/:slug',
      '/:locale(en|es|pl|pt|de|fr|it)/blog/:slug',
    ];

    // Property + agent + city-landing pages — same edge-cache rationale
    // as the blog. The listing body is static once published; agents
    // edit infrequently (~weekly); CF Pages caches the rendered HTML.
    // s-maxage shortened to 5 min (vs blog 1 hr) because edits to a
    // listing's status (unpublish, price drop) need to propagate
    // faster than blog edits. SWR=30 min lets readers always get an
    // instant page while a fresh render runs in the background.
    const listingCacheHeader = [
      {
        key: 'Cache-Control',
        value: 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800',
      },
    ];
    const listingCacheGlobs = [
      '/properties/:slug',
      '/agents/:slug',
      '/properties-in/:country',
      '/properties-in/:country/:city',
      '/:locale(en|es|pl|pt|de|fr|it)/properties/:slug',
      '/:locale(en|es|pl|pt|de|fr|it)/agents/:slug',
      '/:locale(en|es|pl|pt|de|fr|it)/properties-in/:country',
      '/:locale(en|es|pl|pt|de|fr|it)/properties-in/:country/:city',
      // Spanish localized property slug (PATHNAMES alternate)
      '/:locale(en|es|pl|pt|de|fr|it)/propiedades/:slug',
    ];
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      ...authedPathGlobs.map((source) => ({
        source,
        headers: noIndexHeader,
      })),
      ...blogCacheGlobs.map((source) => ({
        source,
        headers: blogCacheHeader,
      })),
      ...listingCacheGlobs.map((source) => ({
        source,
        headers: listingCacheHeader,
      })),
    ];
  },
};

export default withNextIntl(config);
