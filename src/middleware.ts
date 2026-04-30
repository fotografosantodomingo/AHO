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
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$|api/|auth/callback).*)',
  ],
};
