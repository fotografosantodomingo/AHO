import { publicEnv } from '@/lib/env';
import { citySlug } from '@/lib/listings/search';
import {
  MARKETING_LASTMOD,
  buildContentAlternates,
  maxDate,
  renderSitemap,
  xmlResponse,
  type UrlEntry,
} from '@/lib/seo/sitemap-helpers';
import { fetchSitemapListings } from '@/lib/seo/sitemap-listings';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * GET /sitemap-locations.xml — country + city landing pages derived
 * from the active+published listing set.
 *
 * Country landings: `/{locale}/properties-in/{country}` — one per
 * distinct country with active listings.
 *
 * City landings: `/{locale}/properties-in/{country}/{city-slug}` —
 * one per distinct (country, city) pair. Per HANDOFF.md §16.7 these
 * are the canonical SEO-indexable browse paths (since /search itself
 * is noindex'd via robots.txt).
 *
 * Per-URL `lastmod` = max of `updated_at` across the listings under
 * that location. A new listing in Santo Domingo bumps the Santo Domingo
 * city URL's lastmod and the DO country URL's lastmod.
 */
export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const rows = await fetchSitemapListings();

  const cityListingDates = new Map<string, Array<string | null>>();
  const countryListingDates = new Map<string, Array<string | null>>();
  const cityPairs = new Map<string, { country: string; city: string }>();
  const countryCodes = new Set<string>();
  for (const row of rows) {
    if (!row.country_code) continue;
    const cc = row.country_code.toLowerCase();
    countryCodes.add(cc);
    const cArr = countryListingDates.get(cc) ?? [];
    cArr.push(row.updated_at);
    countryListingDates.set(cc, cArr);
    if (!row.city) continue;
    const key = `${cc}/${citySlug(row.city)}`;
    if (!cityPairs.has(key)) {
      cityPairs.set(key, { country: cc, city: citySlug(row.city) });
    }
    const arr = cityListingDates.get(key) ?? [];
    arr.push(row.updated_at);
    cityListingDates.set(key, arr);
  }

  const entries: UrlEntry[] = [];

  // Country-level landings
  for (const cc of countryCodes) {
    const enUrl = `${site}/en/properties-in/${cc}`;
    const esUrl = `${site}/es/inmuebles-en/${cc}`;
    const lastmod =
      maxDate(countryListingDates.get(cc) ?? []) ?? MARKETING_LASTMOD;
    const languages = buildContentAlternates({ enUrl, esUrl });
    entries.push(
      {
        loc: enUrl,
        lastmod,
        changefreq: 'daily',
        priority: 0.55,
        alternates: languages,
      },
      {
        loc: esUrl,
        lastmod,
        changefreq: 'daily',
        priority: 0.55,
        alternates: languages,
      },
    );
  }

  // City-level landings
  for (const [key, { country, city }] of cityPairs) {
    const enUrl = `${site}/en/properties-in/${country}/${city}`;
    const esUrl = `${site}/es/inmuebles-en/${country}/${city}`;
    const lastmod =
      maxDate(cityListingDates.get(key) ?? []) ?? MARKETING_LASTMOD;
    const languages = buildContentAlternates({ enUrl, esUrl });
    entries.push(
      {
        loc: enUrl,
        lastmod,
        changefreq: 'daily',
        priority: 0.6,
        alternates: languages,
      },
      {
        loc: esUrl,
        lastmod,
        changefreq: 'daily',
        priority: 0.6,
        alternates: languages,
      },
    );
  }

  return xmlResponse(renderSitemap(entries), 600);
}
