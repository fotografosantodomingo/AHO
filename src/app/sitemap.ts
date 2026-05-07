import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { citySlug } from '@/lib/listings/search';

// next-on-pages requires explicit runtime declaration. Sitemap reads from
// Supabase per-request, so it can't be statically generated at build time.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * AHO sitemap — surfaced at `/sitemap.xml` via Next.js's metadata-route
 * convention.
 *
 * What's listed:
 *   - Marketing chrome: homepage, pricing, privacy, terms (both locales)
 *   - Every active+published property (both locales, with hreflang alternates)
 *   - City landing pages — derived from distinct (country, city) pairs in
 *     the active+published listing set. Per HANDOFF.md §16.7, these are
 *     the canonical SEO-indexable browse paths (since /search itself is
 *     noindex). One entry per (country, city, locale) with hreflang.
 *   - Agent profile pages — one per organization that has at least one
 *     active+published listing. Surfaces `RealEstateAgent` / `Organization`
 *     JSON-LD-bearing pages to crawlers for branded searches.
 *
 * What's NOT listed (intentional):
 *   - /search and /buscar — faceted URLs cause infinite crawl per spec §16.7
 *   - /dashboard, /panel, /api, /auth — non-public surfaces (also disallowed
 *     by robots.txt)
 *   - /onboarding/welcome, /inicio/bienvenida — auth-gated, also noindex'd
 *   - /admin — internal moderation surface (also disallowed by robots.txt)
 *
 * Hreflang alternates: each entry is emitted in EN and ES with Next.js's
 * `alternates` block so Google understands the locale pairing.
 *
 * Test-fixture exclusion is consistent across all three list types
 * (properties / cities / agents) — they all derive from the
 * properties/organizations tables filtered by `aho-test-org-*` org slug
 * + `aho-fixture-*` listing slug. The `aho-test-org-a/b` orgs themselves
 * never appear as agent-profile URLs because they have no active+published
 * listings (the inner-join filter eliminates them).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const now = new Date();

  // Marketing chrome — all bilingual; we always emit hreflang pairs.
  const marketing: MetadataRoute.Sitemap = [
    {
      url: `${site}/en`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
      alternates: {
        languages: { en: `${site}/en`, es: `${site}/es`, 'x-default': `${site}/en` },
      },
    },
    {
      url: `${site}/es`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
      alternates: {
        languages: { en: `${site}/en`, es: `${site}/es`, 'x-default': `${site}/en` },
      },
    },
    {
      url: `${site}/en/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: {
        languages: {
          en: `${site}/en/pricing`,
          es: `${site}/es/precios`,
          'x-default': `${site}/en/pricing`,
        },
      },
    },
    {
      url: `${site}/es/precios`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: {
        languages: {
          en: `${site}/en/pricing`,
          es: `${site}/es/precios`,
          'x-default': `${site}/en/pricing`,
        },
      },
    },
    {
      url: `${site}/en/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
      alternates: {
        languages: {
          en: `${site}/en/privacy`,
          es: `${site}/es/privacidad`,
          'x-default': `${site}/en/privacy`,
        },
      },
    },
    {
      url: `${site}/es/privacidad`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
      alternates: {
        languages: {
          en: `${site}/en/privacy`,
          es: `${site}/es/privacidad`,
          'x-default': `${site}/en/privacy`,
        },
      },
    },
    {
      url: `${site}/en/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
      alternates: {
        languages: {
          en: `${site}/en/terms`,
          es: `${site}/es/terminos`,
          'x-default': `${site}/en/terms`,
        },
      },
    },
    {
      url: `${site}/es/terminos`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.2,
      alternates: {
        languages: {
          en: `${site}/en/terms`,
          es: `${site}/es/terminos`,
          'x-default': `${site}/en/terms`,
        },
      },
    },
    {
      url: `${site}/en/countries`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.6,
      alternates: {
        languages: {
          en: `${site}/en/countries`,
          es: `${site}/es/paises`,
          'x-default': `${site}/en/countries`,
        },
      },
    },
    {
      url: `${site}/es/paises`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.6,
      alternates: {
        languages: {
          en: `${site}/en/countries`,
          es: `${site}/es/paises`,
          'x-default': `${site}/en/countries`,
        },
      },
    },
  ];

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
    const lastMod = new Date((row.updated_at as string) ?? (row.published_at as string));
    const langs = {
      ...(enUrl ? { en: enUrl } : {}),
      ...(esUrl ? { es: esUrl } : {}),
      ...(enUrl ? { 'x-default': enUrl } : esUrl ? { 'x-default': esUrl } : {}),
    };
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
  const cityPairs = new Map<string, { country: string; city: string }>();
  const countryCodes = new Set<string>();
  for (const row of cleanRows) {
    if (!row.country_code) continue;
    countryCodes.add(row.country_code.toLowerCase());
    if (!row.city) continue;
    const key = `${row.country_code.toLowerCase()}/${citySlug(row.city)}`;
    if (!cityPairs.has(key)) {
      cityPairs.set(key, { country: row.country_code.toLowerCase(), city: citySlug(row.city) });
    }
  }
  // Country-level landing pages — one per distinct country with active listings.
  const countryLandings: MetadataRoute.Sitemap = [];
  for (const cc of countryCodes) {
    const enUrl = `${site}/en/properties-in/${cc}`;
    const esUrl = `${site}/es/inmuebles-en/${cc}`;
    countryLandings.push(
      {
        url: enUrl,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.55,
        alternates: { languages: { en: enUrl, es: esUrl, 'x-default': enUrl } },
      },
      {
        url: esUrl,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.55,
        alternates: { languages: { en: enUrl, es: esUrl, 'x-default': enUrl } },
      },
    );
  }
  const cityLandings: MetadataRoute.Sitemap = [];
  for (const { country, city } of cityPairs.values()) {
    const enUrl = `${site}/en/properties-in/${country}/${city}`;
    const esUrl = `${site}/es/inmuebles-en/${country}/${city}`;
    cityLandings.push(
      {
        url: enUrl,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.6,
        alternates: { languages: { en: enUrl, es: esUrl, 'x-default': enUrl } },
      },
      {
        url: esUrl,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.6,
        alternates: { languages: { en: enUrl, es: esUrl, 'x-default': enUrl } },
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
  const agentPairs = new Map<string, { slug: string; updatedAt: string | null }>();
  for (const row of cleanRows) {
    const org = Array.isArray(row.organizations)
      ? row.organizations[0]
      : row.organizations;
    if (!org || typeof org !== 'object' || !('slug' in org)) continue;
    const legacySlug = (org as { slug: string }).slug;
    const publicSlug = (org as { public_slug?: string | null }).public_slug ?? null;
    const canonicalSlug = publicSlug ?? legacySlug;
    if (!canonicalSlug || agentPairs.has(canonicalSlug)) continue;
    agentPairs.set(canonicalSlug, {
      slug: canonicalSlug,
      updatedAt:
        ((org as { updated_at?: string | null }).updated_at as string | null) ?? null,
    });
  }
  const agents: MetadataRoute.Sitemap = [];
  for (const { slug, updatedAt } of agentPairs.values()) {
    const enUrl = `${site}/en/agents/${slug}`;
    const esUrl = `${site}/es/agentes/${slug}`;
    const lastMod = updatedAt ? new Date(updatedAt) : now;
    agents.push(
      {
        url: enUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages: { en: enUrl, es: esUrl, 'x-default': enUrl } },
      },
      {
        url: esUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.5,
        alternates: { languages: { en: enUrl, es: esUrl, 'x-default': enUrl } },
      },
    );
  }

  return [...marketing, ...listings, ...countryLandings, ...cityLandings, ...agents];
}
