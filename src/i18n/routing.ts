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
  pathnames: PATHNAMES,
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

// Re-export `localePath` from a pure module so consumers can keep
// importing from `@/i18n/routing` without pulling next-intl/navigation
// into Vitest unit tests (which can't resolve next/navigation in the
// test runtime). The implementation lives in `./locale-path`.
export { localePath } from './locale-path';
