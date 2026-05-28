import { type NextRequest, NextResponse } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { routing } from '@/i18n/routing';

type CookieToSet = { name: string; value: string; options: CookieOptions };

const intlMiddleware = createIntlMiddleware(routing);

/**
 * Middleware chain:
 *   1. Run next-intl to handle locale routing (redirects `/` to `/{locale}/`,
 *      rewrites `/{locale}/propiedades/...` <-> `/properties/...`, etc.).
 *   2. If next-intl returned a redirect, return it as-is — no auth refresh
 *      needed for redirect responses.
 *   3. Otherwise, run Supabase session refresh on the response that next-intl
 *      produced and return that.
 *
 * Webhook endpoints under `/api/webhooks/*` and static assets are excluded
 * by the matcher below — webhooks authenticate via signatures, not cookies,
 * and locale rewriting on webhook URLs would break the contract.
 */
export async function middleware(req: NextRequest) {
  // Defensive: reject literal bracket characters in the path. They can
  // only appear if a client constructed a URL from an unresolved route
  // template like `/es/propiedades/[slug]` — usually because of a
  // stale-cached client bundle from before today's locale-toggle fix.
  // next-intl's middleware throws when it tries to route bracket-
  // containing paths against the `pathnames` config, which surfaces as
  // a Cloudflare-level "Internal Server Error" plaintext (the worker
  // can't unwind cleanly enough to render Next's 404 template). Return
  // a clean 404 here instead. Logged 2026-05-02 after PO hit
  // `/es/propiedades/[slug]` from a stale client.
  const rawPath = req.nextUrl.pathname;
  // Brackets can appear in either the decoded form `[`/`]` or the URL-
  // encoded form `%5B`/`%5D` depending on how the client constructed
  // the URL and how Next.js's NextURL normalizes it. Reject both.
  if (
    rawPath.includes('[') ||
    rawPath.includes(']') ||
    /%5[bd]/i.test(rawPath)
  ) {
    return new NextResponse('Not Found', {
      status: 404,
      headers: { 'content-type': 'text/plain;charset=UTF-8' },
    });
  }

  // 1. next-intl first.
  const intlRes = intlMiddleware(req);

  // If next-intl issued a redirect, short-circuit.
  if (intlRes.headers.get('location')) {
    return intlRes;
  }

  // 2. Supabase session refresh on the rewritten request, layered onto the
  // intl response so its locale headers / cookies are preserved.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnon) {
    return intlRes;
  }

  let res = intlRes;
  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        // Carry over any headers next-intl set (locale, content-language, etc.)
        intlRes.headers.forEach((value, key) => {
          if (!res.headers.has(key)) res.headers.set(key, value);
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  // Security headers on every response. Set in middleware (not in
  // next.config.ts:headers()) because next-on-pages's Edge Function
  // responses don't pick up the static headers() config. Lighthouse
  // Best Practices audits five of these explicitly; without them
  // /en/blog scores 77 instead of 100 (PO Lighthouse run 2026-05-28).
  //
  //  - Strict-Transport-Security  — Lighthouse "HSTS" audit, ~10pt
  //    Two-year max-age + includeSubDomains is the preload-eligible
  //    threshold. Once the site is in the Chromium preload list (PO
  //    action, separate), the `preload` directive can be added; today
  //    advertisehomes.online is not yet preloaded so we omit it to
  //    keep deletion reversible.
  //  - Cross-Origin-Opener-Policy — Lighthouse "COOP" audit, ~10pt
  //    `same-origin` isolates the page from cross-origin opens so a
  //    Spectre-style timing attack via window.opener can't reach us.
  //    Compatible with our flows: Stripe redirect to checkout.stripe.com
  //    is a same-tab navigation (NOT window.open), so COOP can't break it.
  //  - X-Content-Type-Options: nosniff — Lighthouse minor audit.
  //    Prevents MIME-sniffing of script/style assets; we always set
  //    explicit Content-Type so nosniff is purely defensive.
  //  - Referrer-Policy — Lighthouse minor audit. `strict-origin-when-cross-origin`
  //    matches the modern browser default and is what Lighthouse expects
  //    to be set explicitly.
  //  - Permissions-Policy — Lighthouse minor audit. We don't use any
  //    of camera/microphone/geolocation OUTSIDE the AHO Assistant voice
  //    mode (which is on every page and DOES need microphone). So we
  //    grant microphone=self and deny the rest; geolocation also stays
  //    open because a future feature may use it for "show listings
  //    near me." Browser auto-fills the rest with permissive defaults.
  //
  // Applied to ALL responses including redirects + 404s so the entire
  // surface meets the Lighthouse bar (the blog being the visible miss
  // today, but homepage / properties / agents would all measure the
  // same way without these).
  res.headers.set(
    'strict-transport-security',
    'max-age=63072000; includeSubDomains',
  );
  res.headers.set('cross-origin-opener-policy', 'same-origin');
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  res.headers.set(
    'permissions-policy',
    'camera=(), microphone=(self), geolocation=(self), payment=(self), usb=(), interest-cohort=()',
  );

  // X-Robots-Tag on every authed surface — including 307 redirects
  // out of /dashboard, /admin, etc. The next.config.ts `headers()`
  // config DOES emit this header, but Next.js's `redirect()` machinery
  // (used by the dashboard layout's anon → /signin bounce) generates
  // its 307 BEFORE the headers config is consulted, so the redirect
  // response shipped without the header (QA 2026-05-17). Middleware
  // runs first and on every request, so setting the header here
  // applies to the redirect responses too.
  //
  // Only path-based — we don't look at auth state. A signed-in user
  // viewing /dashboard sees the same noindex header as the anon
  // 307; both are correct (the page should never be indexed regardless).
  const pathname = req.nextUrl.pathname;
  if (
    /^\/(?:[a-z]{2}\/)?(?:dashboard|admin|panel|setup-mfa|onboarding|inicio|preview|vista-previa|investors)(?:\/|$)/.test(
      pathname,
    )
  ) {
    res.headers.set(
      'x-robots-tag',
      'noindex, nofollow, noarchive, nosnippet',
    );
  }

  // Cache-Control for public editorial / listing surfaces — set here
  // (not in next.config.ts:headers()) because next-on-pages's Edge
  // Function responses don't pick up the static `headers()` config.
  // Combined with `localeDetection: false` in i18n/routing.ts (which
  // dropped the per-response Set-Cookie that was making CF skip the
  // cache), this finally lets Cloudflare Pages cache the rendered
  // HTML at the edge:
  //   /blog/[slug]              — 1h s-maxage (blog posts are static)
  //   /properties/[slug]        — 5m s-maxage (listings can flip status)
  //   /agents/[slug]            — 5m s-maxage (agent profile edits)
  //   /properties-in/<country>[/<city>]  — 5m s-maxage (city landings)
  //
  // ONLY for anonymous visitors (no Supabase auth cookies) — once a
  // user is signed in, their per-user response shouldn't be cached.
  const isAnon = !req.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') || c.name === 'supabase-auth-token');
  if (isAnon) {
    if (
      /^\/(?:[a-z]{2}\/)?blog\//.test(pathname)
    ) {
      res.headers.set(
        'cache-control',
        'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      );
    } else if (
      /^\/(?:[a-z]{2}\/)?(?:properties|propiedades|agents|properties-in)(?:\/|$)/.test(
        pathname,
      )
    ) {
      res.headers.set(
        'cache-control',
        'public, max-age=60, s-maxage=300, stale-while-revalidate=1800',
      );
    }
  }

  // Strip the next-intl NEXT_LOCALE cookie on anon requests for the
  // public cacheable surfaces. Despite `localeDetection: false` in
  // i18n/routing.ts, next-intl still emits Set-Cookie: NEXT_LOCALE
  // on locale-routed responses — and any Set-Cookie kills the CF
  // edge cache (CDN treats the response as personalized). Without
  // this strip, the Cache-Control header above is set but ignored
  // (cf-cache-status stays DYNAMIC instead of flipping to HIT).
  // Fixed 2026-05-21 after `/en/blog` still showed DYNAMIC + 1.5s
  // server time on repeat fetches.
  if (
    isAnon &&
    /^\/(?:[a-z]{2}\/)?(?:blog|properties|propiedades|agents|properties-in)(?:\/|$)/.test(
      pathname,
    )
  ) {
    res.cookies.delete('NEXT_LOCALE');
    // res.cookies.delete only marks the cookie for deletion with an
    // expired Max-Age; the original Set-Cookie header may still be
    // present from next-intl. Sweep the headers list to drop any
    // NEXT_LOCALE Set-Cookie entries entirely so the response has
    // ZERO Set-Cookie headers for the CDN to choke on.
    const remaining = res.headers
      .getSetCookie?.()
      ?.filter((c) => !/^NEXT_LOCALE=/.test(c)) ?? [];
    res.headers.delete('set-cookie');
    for (const c of remaining) res.headers.append('set-cookie', c);
  }

  return res;
}

export const config = {
  matcher: [
    // Exclude:
    //   - Next.js static / image / favicon
    //   - Common image asset extensions
    //   - All API routes (webhooks authenticate via signatures, not cookies;
    //     other API routes do their own session resolution and don't need
    //     locale rewriting)
    //   - Supabase auth callback (locale-agnostic; rewriting to /en/auth/callback
    //     would 404)
    //   - SEO metadata routes (sitemap.xml, robots.txt) — they live at the
    //     site root and must NOT get a locale prefix; otherwise crawlers see
    //     a 307 to `/en/sitemap.xml` and ignore the canonical URL.
    //     Match `sitemap.xml` AND every child of the sitemap-index split
    //     shipped 2026-05-14 (sitemap-pages, sitemap-landings,
    //     sitemap-properties, sitemap-agents, sitemap-locations,
    //     sitemap-images) via `sitemap(?:-[a-z]+)?\\.xml`. Bug
    //     2026-05-14: only `sitemap.xml` + `sitemap-images.xml` were
    //     listed literally, so the 5 new sub-sitemaps fell through to
    //     next-intl which 307'd them to `/en/…` and Google reported
    //     "Couldn't fetch" on every child of the index.
    //   - PWA root assets (sw.js, manifest.webmanifest) — service worker
    //     registration scope is `/`, so these must stay at the site root
    //     without a locale prefix.
    //   - /leaflet/* — vendored Leaflet CSS + marker images; without the
    //     exclusion, next-intl 307s `/leaflet/leaflet.css` → `/en/leaflet/
    //     leaflet.css` which 404s, and the search-page map renders blank
    //     because the tile layer has no styling. Same logic for `.css`
    //     in general; safer to excluded the entire vendored dir.
    //   - `.css` files anywhere — locale-prefixing a stylesheet has no
    //     legitimate use case and breaks every static-CSS asset that
    //     gets fetched outside `_next/static`.
    //   - `.woff` + `.woff2` font files — same logic as `.css`. Bug
    //     2026-05-17: `/fonts/inter-700.woff2` was being 307'd to
    //     `/en/fonts/inter-700.woff2` by next-intl, the OG-image font
    //     loader's `fetch()` either failed or got an HTML 404 instead
    //     of the woff2 bytes, satori crashed silently, and every
    //     ImageResponse route returned 0 bytes. This was the REAL
    //     cause of the "ImageResponse broken" QA finding — not the
    //     `devIndicators: false` change I initially reverted.
    //   - `/offline.html` — the PWA's offline shell. The service worker
    //     (`public/sw.js`) precaches it on install via cache.addAll;
    //     if the middleware 307s it to `/en/offline.html` (because
    //     `offline.html` wasn't in the exclude list), `addAll` rejects,
    //     SW install fails, and on the next deploy the page is served
    //     in a broken hybrid state (old chunks + new HTML → "Application
    //     error" in the browser console). Diagnosed 2026-05-19 after
    //     the chat-gate deploy.
    '/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|sitemap(?:-[a-z]+)?\\.xml|robots\\.txt|sw\\.js|manifest\\.webmanifest|offline\\.html|leaflet/|fonts/|.*\\.(?:css|svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf)$|api/|auth/callback).*)',
  ],
};
