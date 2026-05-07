import { LOCALES, PATHNAMES, type Locale } from '@/i18n/config';

/**
 * Build the `alternates` block (canonical + per-locale languages) for
 * a marketing landing page that lives under one of the localized
 * pathnames keys. Returns absolute URLs ready for Next.js Metadata
 * `alternates` and for sitemap hreflang.
 *
 * Example: pathKey = '/for-agents', currentLocale = 'pl' →
 *   canonical = `${site}/pl/dla-agentow`
 *   languages = { en: `${site}/en/for-agents`, es: `${site}/es/para-agentes`, ... }
 */
export function buildLandingAlternates(args: {
  pathKey: keyof typeof PATHNAMES;
  currentLocale: Locale;
  siteUrl: string;
}): {
  canonical: string;
  languages: Record<string, string>;
  /** All URLs as a flat list — handy for sitemap iteration. */
  allUrls: Array<{ locale: Locale; url: string }>;
} {
  const path = PATHNAMES[args.pathKey];
  if (typeof path === 'string') {
    // Path is the same in every locale (rare for landing pages).
    const allUrls = LOCALES.map((l) => ({
      locale: l,
      url: `${args.siteUrl}/${l}${path === '/' ? '' : path}`,
    }));
    const langs: Record<string, string> = {};
    for (const u of allUrls) langs[u.locale] = u.url;
    langs['x-default'] = allUrls.find((u) => u.locale === 'en')?.url ?? allUrls[0]!.url;
    return {
      canonical:
        allUrls.find((u) => u.locale === args.currentLocale)?.url ??
        allUrls[0]!.url,
      languages: langs,
      allUrls,
    };
  }
  const localizedPaths = path as Record<Locale, string>;
  const allUrls = LOCALES.map((l) => ({
    locale: l,
    url: `${args.siteUrl}/${l}${localizedPaths[l]}`,
  }));
  const langs: Record<string, string> = {};
  for (const u of allUrls) langs[u.locale] = u.url;
  langs['x-default'] = allUrls.find((u) => u.locale === 'en')?.url ?? allUrls[0]!.url;
  return {
    canonical:
      allUrls.find((u) => u.locale === args.currentLocale)?.url ?? allUrls[0]!.url,
    languages: langs,
    allUrls,
  };
}
