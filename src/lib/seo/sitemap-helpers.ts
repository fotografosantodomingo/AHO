import type { MetadataRoute } from 'next';
import { LOCALES, PATHNAMES, type Locale } from '@/i18n/config';

/**
 * Sitemap composition helpers — pure functions, fully unit-testable
 * without any Supabase / network dependency.
 *
 * Two locale "tiers" exist in the sitemap:
 *
 *   - **Marketing chrome locales** (all 7 in `LOCALES`): pages whose
 *     content lives in `messages/{locale}.json` and is fully translated
 *     across the 7 launch + acquisition locales (EN/ES/PL/PT/DE/FR/IT).
 *     The homepage, pricing, privacy, terms, /countries, and the
 *     agent-acquisition landings (`/for-agents`, `/automation`,
 *     `/save-time`) all qualify. Each page emits one URL per locale,
 *     each carrying hreflang alternates pointing to the other six.
 *
 *   - **Content-locale pages** (EN + ES only): property detail, agent
 *     profile, country & city landing pages. Listing copy itself only
 *     exists in EN/ES per the bilingual data model — emitting PL/PT/DE/
 *     FR/IT URLs for those would point at pages that 404 or render
 *     EN content under a foreign URL, both of which Google would
 *     justifiably penalise.
 *
 * Helpers here only build the URL-shape data; the route-handler in
 * `src/app/sitemap.ts` wires Supabase data into them.
 */

/**
 * Fixed lastmod for marketing chrome pages. Using a per-request `new
 * Date()` would tell Google "this URL changed every minute" — that's
 * a noise signal that erodes crawl-budget targeting. Bump this constant
 * when you ship a meaningful change to the marketing chrome (copy
 * rewrite, route move, etc.); incidental UI-token tweaks don't warrant
 * a bump.
 */
export const MARKETING_LASTMOD = new Date('2026-05-09T00:00:00Z');

/**
 * Build a per-locale URL given a PATHNAMES key and a base site URL.
 * Returns the full absolute URL for that locale, e.g.
 *   `https://example.com/pl/dla-agentow`
 */
export function localeUrl(args: {
  siteUrl: string;
  locale: Locale;
  pathKey: keyof typeof PATHNAMES;
}): string {
  const path = PATHNAMES[args.pathKey];
  if (typeof path === 'string') {
    return path === '/'
      ? `${args.siteUrl}/${args.locale}`
      : `${args.siteUrl}/${args.locale}${path}`;
  }
  const localized = (path as Record<Locale, string>)[args.locale];
  return localized === '/'
    ? `${args.siteUrl}/${args.locale}`
    : `${args.siteUrl}/${args.locale}${localized}`;
}

/**
 * Build the `alternates.languages` map for a multi-locale page driven
 * by a PATHNAMES key. Includes every locale in `LOCALES` plus an
 * `x-default` pointing at the EN URL (per Google's hreflang spec —
 * `x-default` should always be the broadest fallback).
 */
export function buildAllLocaleAlternates(args: {
  siteUrl: string;
  pathKey: keyof typeof PATHNAMES;
}): Record<string, string> {
  const langs: Record<string, string> = {};
  for (const locale of LOCALES) {
    langs[locale] = localeUrl({
      siteUrl: args.siteUrl,
      locale,
      pathKey: args.pathKey,
    });
  }
  langs['x-default'] = langs.en ?? langs[LOCALES[0]]!;
  return langs;
}

/**
 * Build the `alternates.languages` map for a content page that exists
 * in EN + ES only (property detail, agent profile, country/city
 * landings). EN is `x-default`. Either side may be null when only one
 * language slug is populated for a listing (we never fall back across
 * languages per the bilingual data rule in CLAUDE.md).
 */
export function buildContentAlternates(args: {
  enUrl: string | null;
  esUrl: string | null;
}): Record<string, string> {
  const langs: Record<string, string> = {};
  if (args.enUrl) langs.en = args.enUrl;
  if (args.esUrl) langs.es = args.esUrl;
  langs['x-default'] = args.enUrl ?? args.esUrl ?? '';
  if (!langs['x-default']) delete langs['x-default'];
  return langs;
}

/**
 * Marketing chrome pathnames keys — pages that emit one entry per
 * locale (7 entries each). Order is preserved in the sitemap output.
 */
export const MARKETING_PATH_KEYS = [
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/countries',
] as const;

/** Per-page change-frequency + priority hints for the marketing chrome. */
const MARKETING_HINTS: Record<
  (typeof MARKETING_PATH_KEYS)[number],
  { changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }
> = {
  '/': { changeFrequency: 'weekly', priority: 1.0 },
  '/pricing': { changeFrequency: 'monthly', priority: 0.7 },
  '/privacy': { changeFrequency: 'yearly', priority: 0.2 },
  '/terms': { changeFrequency: 'yearly', priority: 0.2 },
  '/countries': { changeFrequency: 'daily', priority: 0.6 },
};

/**
 * Build sitemap entries for the marketing chrome — one entry per page
 * per locale, each carrying hreflang alternates pointing to the other
 * six. Uses a fixed `lastModified` to avoid per-request churn.
 */
export function buildMarketingChromeEntries(args: {
  siteUrl: string;
  lastModified?: Date;
}): MetadataRoute.Sitemap {
  const lastModified = args.lastModified ?? MARKETING_LASTMOD;
  const out: MetadataRoute.Sitemap = [];
  for (const pathKey of MARKETING_PATH_KEYS) {
    const languages = buildAllLocaleAlternates({
      siteUrl: args.siteUrl,
      pathKey,
    });
    const hints = MARKETING_HINTS[pathKey];
    for (const locale of LOCALES) {
      out.push({
        url: localeUrl({ siteUrl: args.siteUrl, locale, pathKey }),
        lastModified,
        changeFrequency: hints.changeFrequency,
        priority: hints.priority,
        alternates: { languages },
      });
    }
  }
  return out;
}

/**
 * Pick the latest of the supplied dates (skipping null/undefined).
 * Returns null when nothing is supplied. Used to compute `lastmod` for
 * city / country landing pages (max of the listings under them) and
 * agent profile pages (max of org.updated_at + listings' updated_at).
 */
export function maxDate(
  dates: ReadonlyArray<Date | string | null | undefined>,
): Date | null {
  let best: Date | null = null;
  for (const d of dates) {
    if (d == null) continue;
    const parsed = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(parsed.getTime())) continue;
    if (best === null || parsed.getTime() > best.getTime()) best = parsed;
  }
  return best;
}
