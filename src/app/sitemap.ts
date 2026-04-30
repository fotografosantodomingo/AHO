import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
 *
 * What's NOT listed (intentional):
 *   - /search and /buscar — faceted URLs cause infinite crawl per spec §16.7
 *   - /dashboard, /panel, /api, /auth — non-public surfaces (also disallowed
 *     by robots.txt)
 *   - /onboarding/welcome, /inicio/bienvenida — auth-gated, also noindex'd
 *
 * Hreflang alternates: each property + each marketing page is emitted in
 * EN and ES with Next.js's `alternates` block so Google understands the
 * locale pairing.
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
      'short_id, slug_en, slug_es, updated_at, published_at, status, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000); // sitemap protocol cap is 50k URLs per file

  if (error || !rows) {
    return marketing;
  }

  const listings: MetadataRoute.Sitemap = [];
  for (const row of rows) {
    // Belt-and-suspenders: even if the org-slug filter misbehaves under
    // some future PostgREST version, drop anything that *looks* like a
    // fixture by listing slug.
    if (
      row.slug_en?.startsWith('aho-fixture-') ||
      row.slug_es?.startsWith('aho-fixture-')
    ) {
      continue;
    }
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

  return [...marketing, ...listings];
}
