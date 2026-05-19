import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';
import { DEFAULT_LOCALE, LOCALES, PATHNAMES } from './config';

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  // `as-needed` would strip `/en` from the default-locale URLs. We use
  // `always` so SEO metadata, hreflang, and shared links all carry an
  // explicit locale — fewer surprises, clearer canonical URLs.
  localePrefix: 'always',
  // Locale detection OFF. With `localePrefix: 'always'`, every URL
  // already encodes the locale in the path, so detection-via-cookie +
  // Accept-Language is redundant. Turning it off means next-intl no
  // longer writes a `Set-Cookie: NEXT_LOCALE=…` header on every
  // response — which was blocking Cloudflare Pages' edge cache (the
  // CDN treats any response with Set-Cookie as uncacheable by default,
  // so Cache-Control: public, s-maxage=300 was being ignored). Fixed
  // 2026-05-19 after Lighthouse showed LCP 6.8s on /properties/[slug]
  // (server response ~1.1s per request). The language toggle in the
  // header still works because it uses explicit locale-prefixed URLs
  // via next-intl's <Link>, not cookie-based detection.
  localeDetection: false,
  pathnames: PATHNAMES,
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

// Re-export `localePath` from a pure module so consumers can keep
// importing from `@/i18n/routing` without pulling next-intl/navigation
// into Vitest unit tests (which can't resolve next/navigation in the
// test runtime). The implementation lives in `./locale-path`.
export { localePath } from './locale-path';
