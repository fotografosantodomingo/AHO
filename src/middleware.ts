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
    '/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|sitemap(?:-[a-z]+)?\\.xml|robots\\.txt|sw\\.js|manifest\\.webmanifest|leaflet/|.*\\.(?:css|svg|png|jpg|jpeg|gif|webp|avif|ico)$|api/|auth/callback).*)',
  ],
};
