import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { citySlug } from '@/lib/listings/search';
import { buildLandingAlternates } from '@/lib/seo/landing-alternates';
import {
  MARKETING_LASTMOD,
  buildContentAlternates,
  buildMarketingChromeEntries,
  maxDate,
} from '@/lib/seo/sitemap-helpers';

// next-on-pages requires explicit runtime declaration. Sitemap reads from
// Supabase per-request, so it can't be statically generated at build time.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * AHO sitemap — surfaced at `/sitemap.xml` via Next.js's metadata-route
 * convention.
 *
 * What's listed:
 *   - Marketing chrome: homepage, pricing, privacy, terms, /countries
 *     (one entry per locale × 7 locales, hreflang-linked across all of
 *     them — copy is fully translated in `messages/{locale}.json`).
 *   - Every active+published property (EN+ES, with hreflang alternates).
 *     `lastmod` = the listing's `updated_at`.
 *   - City landing pages — derived from distinct (country, city) pairs
 *     in the active+published listing set. Per HANDOFF.md §16.7, these
 *     are the canonical SEO-indexable browse paths (since /search itself
 *     is noindex). One entry per (country, city, locale) with hreflang.
 *     `lastmod` = max `updated_at` of the listings in that city.
 *   - Country landing pages — one per distinct country with active
 *     listings. `lastmod` = max `updated_at` of the country's listings.
 *   - Agent profile pages — one per organization that has at least one
 *     active+published listing. Surfaces `RealEstateAgent` /
 *     `Organization` JSON-LD-bearing pages to crawlers for branded
 *     searches. `lastmod` = max(org.updated_at, max listing updated_at).
 *   - Agent-acquisition landings (/for-agents, /automation, /save-time)
 *     across all 7 locales with localized slugs.
 *
 * What's NOT listed (intentional):
 *   - /search and /buscar — faceted URLs cause infinite crawl per spec §16.7
 *   - /dashboard, /panel, /api, /auth — non-public surfaces (also disallowed
 *     by robots.txt)
 *   - /onboarding/welcome, /inicio/bienvenida — auth-gated, also noindex'd
 *   - /admin — internal moderation surface (also disallowed by robots.txt)
 *
 * Hreflang alternates: every entry carries an `alternates.languages` map
 * that Next.js renders as `<xhtml:link rel="alternate" hreflang="…" />`
 * children of each `<url>`. Marketing chrome links across all 7 locales;
 * content pages link EN ↔ ES only (the listing data model is bilingual,
 * not septalingual — surfacing a PL URL for a property whose copy is in
 * English would be a Google ranking penalty, not a help).
 *
 * lastmod precision: only the marketing chrome uses a fixed
 * (build-time) lastmod. Every data-driven URL pulls a real timestamp
 * from Supabase. Per-request `new Date()` lastmods would tell Google
 * "this URL changes every minute" which wastes crawl budget and erodes
 * the lastmod signal for URLs that genuinely changed.
 *
 * Test-fixture exclusion is consistent across all four list types
 * (properties / cities / countries / agents) — they all derive from the
 * properties/organizations tables filtered by `aho-test-org-*` org slug
 * + `aho-fixture-*` listing slug. The `aho-test-org-a/b` orgs themselves
 * never appear as agent-profile URLs because they have no active+published
 * listings (the inner-join filter eliminates them).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();

  // Marketing chrome — 5 pages × 7 locales = 35 URLs, each with full
  // 7-locale hreflang. Built from the static helper so it stays
  // unit-testable without a Supabase round-trip.
  const marketing = buildMarketingChromeEntries({ siteUrl: site });

  // Property listings — only active+published. RLS public-read policy
  // already filters to those, but we double-check in the where clause to
  // be defensive (no surprises if policies change).
  //
  // Test-fixture exclusion: per CLAUDE.md "Local-dev quirks", RLS test
  // fixtures live in the production Supabase project until a dedicated
  // test project exists. They have org slugs prefixed `aho-test-org-`
  // and listing slugs prefixed `aho-fixture-`. We must NOT surface them
  // to crawlers (CLAUDE.md hard rule #8: no fake data in user-facing
  // contexts; sitemap.xml is user-facing — Google's the user). Filter at
  // both layers as belt-and-suspenders.
  const supabase = await createServerSupabaseClient();
  const { data: rows, error } = await supabase
    .from('properties')
    .select(
      'short_id, slug_en, slug_es, updated_at, published_at, status, country_code, city, organizations!inner(slug, public_slug, name, updated_at)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000); // sitemap protocol cap is 50k URLs per file

  if (error || !rows) {
    return marketing;
  }

  // Filter out fixture listings (defensive double-layer per the
  // org-slug filter above).
  const cleanRows = rows.filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const listings: MetadataRoute.Sitemap = [];
  for (const row of cleanRows) {
    const enUrl = row.slug_en
      ? `${site}/en/properties/${row.slug_en}-${row.short_id}`
      : null;
    const esUrl = row.slug_es
      ? `${site}/es/propiedades/${row.slug_es}-${row.short_id}`
      : null;
    const lastMod =
      maxDate([row.updated_at, row.published_at]) ?? MARKETING_LASTMOD;
    const langs = buildContentAlternates({ enUrl, esUrl });
    if (enUrl) {
      listings.push({
        url: enUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: langs },
      });
    }
    if (esUrl) {
      listings.push({
        url: esUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: langs },
      });
    }
  }

  // City + country landing pages — derived from distinct (country, city)
  // pairs and distinct countries in the listing set. We slug the city
  // with the same helper the city-landing route uses for resolution.
  // For each landing, `lastmod` is the max `updated_at` of the listings
  // it contains — that way Google sees a fresh signal whenever an
  // agent in that city updates a listing.
  const cityListingDates = new Map<string, Array<string | null>>();
  const countryListingDates = new Map<string, Array<string | null>>();
  const cityPairs = new Map<string, { country: string; city: string }>();
  const countryCodes = new Set<string>();
  for (const row of cleanRows) {
    if (!row.country_code) continue;
    const cc = row.country_code.toLowerCase();
    countryCodes.add(cc);
    const countryArr = countryListingDates.get(cc) ?? [];
    countryArr.push(row.updated_at as string | null);
    countryListingDates.set(cc, countryArr);
    if (!row.city) continue;
    const key = `${cc}/${citySlug(row.city)}`;
    if (!cityPairs.has(key)) {
      cityPairs.set(key, { country: cc, city: citySlug(row.city) });
    }
    const cityArr = cityListingDates.get(key) ?? [];
    cityArr.push(row.updated_at as string | null);
    cityListingDates.set(key, cityArr);
  }
  // Country-level landing pages — one per distinct country with active listings.
  const countryLandings: MetadataRoute.Sitemap = [];
  for (const cc of countryCodes) {
    const enUrl = `${site}/en/properties-in/${cc}`;
    const esUrl = `${site}/es/inmuebles-en/${cc}`;
    const lastMod =
      maxDate(countryListingDates.get(cc) ?? []) ?? MARKETING_LASTMOD;
    countryLandings.push(
      {
        url: enUrl,
        lastModified: lastMod,
        changeFrequency: 'daily',
        priority: 0.55,
        alternates: { languages: buildContentAlternates({ enUrl, esUrl }) },
      },
      {
        url: esUrl,
        lastModified: lastMod,
        changeFrequency: 'daily',
        priority: 0.55,
        alternates: { languages: buildContentAlternates({ enUrl, esUrl }) },
      },
    );
  }
  const cityLandings: MetadataRoute.Sitemap = [];
  for (const [key, { country, city }] of cityPairs) {
    const enUrl = `${site}/en/properties-in/${country}/${city}`;
    const esUrl = `${site}/es/inmuebles-en/${country}/${city}`;
    const lastMod =
      maxDate(cityListingDates.get(key) ?? []) ?? MARKETING_LASTMOD;
    cityLandings.push(
      {
        url: enUrl,
        lastModified: lastMod,
        changeFrequency: 'daily',
        priority: 0.6,
        alternates: { languages: buildContentAlternates({ enUrl, esUrl }) },
      },
      {
        url: esUrl,
        lastModified: lastMod,
        changeFrequency: 'daily',
        priority: 0.6,
        alternates: { languages: buildContentAlternates({ enUrl, esUrl }) },
      },
    );
  }

  // Agent profile pages — distinct organizations from the listing set.
  // The inner-join filter on the main query already excluded
  // `aho-test-org-*` orgs, so anything that survived is real.
  // We emit the SEO-friendly `public_slug` when the org has one (the
  // canonical URL after the agent fills their profile); otherwise fall
  // back to the legacy `slug`. The route handles both forms — visitors
  // landing via the legacy URL get a 301 to the public_slug.
  //
  // lastmod = max(org.updated_at, all listings' updated_at). A new
  // listing or a listing edit should refresh the agent profile signal
  // even if the org row itself hasn't changed.
  const agentPairs = new Map<
    string,
    { slug: string; orgUpdatedAt: string | null; listingDates: Array<string | null> }
  >();
  for (const row of cleanRows) {
    const org = Array.isArray(row.organizations)
      ? row.organizations[0]
      : row.organizations;
    if (!org || typeof org !== 'object' || !('slug' in org)) continue;
    const legacySlug = (org as { slug: string }).slug;
    const publicSlug = (org as { public_slug?: string | null }).public_slug ?? null;
    const canonicalSlug = publicSlug ?? legacySlug;
    if (!canonicalSlug) continue;
    const existing = agentPairs.get(canonicalSlug);
    if (existing) {
      existing.listingDates.push(row.updated_at as string | null);
    } else {
      agentPairs.set(canonicalSlug, {
        slug: canonicalSlug,
        orgUpdatedAt:
          ((org as { updated_at?: string | null }).updated_at as string | null) ??
          null,
        listingDates: [row.updated_at as string | null],
      });
    }
  }
  const agents: MetadataRoute.Sitemap = [];
  for (const { slug, orgUpdatedAt, listingDates } of agentPairs.values()) {
    const enUrl = `${site}/en/agents/${slug}`;
    const esUrl = `${site}/es/agentes/${slug}`;
    const lastMod =
      maxDate([orgUpdatedAt, ...listingDates]) ?? MARKETING_LASTMOD;
    agents.push(
      {
        url: enUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages: buildContentAlternates({ enUrl, esUrl }) },
      },
      {
        url: esUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages: buildContentAlternates({ enUrl, esUrl }) },
      },
    );
  }

  // Agent-acquisition landing pages — one entry per locale per page,
  // each carrying hreflang alternates pointing to all 7 locale versions.
  // Total: 3 pages × 7 locales = 21 URLs. Static (force-static), so
  // the sitemap can hint daily change frequency without lying. lastmod
  // reuses MARKETING_LASTMOD since these are static pages too.
  const landingPathKeys = [
    '/for-agents',
    '/automation',
    '/save-time',
  ] as const;
  const landings: MetadataRoute.Sitemap = [];
  for (const pathKey of landingPathKeys) {
    // currentLocale doesn't matter for the URL list — each loop run
    // emits a sitemap entry per locale separately. We just need the
    // shared `languages` map and the list of all URLs.
    const alts = buildLandingAlternates({
      pathKey,
      currentLocale: 'en',
      siteUrl: site,
    });
    for (const { url } of alts.allUrls) {
      landings.push({
        url,
        lastModified: MARKETING_LASTMOD,
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: alts.languages },
      });
    }
  }

  return [
    ...marketing,
    ...listings,
    ...countryLandings,
    ...cityLandings,
    ...agents,
    ...landings,
  ];
}
