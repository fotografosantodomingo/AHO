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
