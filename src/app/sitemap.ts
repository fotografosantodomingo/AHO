import type { MetadataRoute } from 'next';
import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { citySlug } from '@/lib/listings/search';
import { buildImageUrl } from '@/lib/listings/image-url';

// next-on-pages requires explicit runtime declaration. Sitemap reads from
// Supabase per-request, so it can't be statically generated at build time.
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * AHO sitemap — partitioned into a sitemap-index at `/sitemap.xml` plus
 * five per-section sub-sitemaps at `/sitemap/{id}.xml`. Next.js generates
 * the index automatically from the IDs returned by `generateSitemaps()`.
 *
 * Sections:
 *   - `marketing`  — homepage, pricing, privacy, terms, countries directory
 *   - `properties` — every active+published property URL, WITH `images:`
 *                    field so each `<url>` emits `<image:image>` children.
 *                    Google Image Search uses these for direct image-result
 *                    surfacing (Zillow / Redfin pattern).
 *   - `cities`     — distinct (country, city) landing pages
 *   - `countries`  — distinct country landing pages
 *   - `agents`     — distinct organization profile pages
 *
 * Why partition instead of a single flat sitemap:
 *   1. **Image sitemap protocol** — Next.js's `images: string[]` field on
 *      sitemap entries triggers `<image:image>` XML children. Worth
 *      isolating to the properties partition where every URL has photos.
 *   2. **Crawl-cadence signaling** — `marketing` is `yearly`; `properties`
 *      is `weekly`; `cities` is `daily`. Crawlers can refresh each on its
 *      own schedule rather than the worst-case across all of them.
 *   3. **50K URL cap** — sitemap protocol limits each file to 50K URLs.
 *      Partitioning gives breathing room as the platform scales without
 *      a future overhaul.
 *
 * What's NOT listed (intentional):
 *   - /search and /buscar — faceted URLs cause infinite crawl per spec §16.7
 *   - /dashboard, /panel, /api, /auth — non-public surfaces (also disallowed
 *     by robots.txt)
 *   - /onboarding/welcome, /inicio/bienvenida — auth-gated, also noindex'd
 *   - /admin — internal moderation surface (also disallowed by robots.txt)
 *
 * Test-fixture exclusion is consistent across all partitions — they all
 * derive from properties/organizations filtered by `aho-test-org-*` org
 * slug + `aho-fixture-*` listing slug per CLAUDE.md hard rule #8 + RISKS.md
 * R11 (RLS test fixtures share the production Supabase project).
 */

type SitemapId = 'marketing' | 'properties' | 'cities' | 'countries' | 'agents';

export async function generateSitemaps(): Promise<{ id: SitemapId }[]> {
  return [
    { id: 'marketing' },
    { id: 'properties' },
    { id: 'cities' },
    { id: 'countries' },
    { id: 'agents' },
  ];
}

export default async function sitemap({
  id,
}: {
  id: SitemapId;
}): Promise<MetadataRoute.Sitemap> {
  switch (id) {
    case 'marketing':
      return marketingSitemap();
    case 'properties':
      return propertiesSitemap();
    case 'cities':
      return citiesSitemap();
    case 'countries':
      return countriesSitemap();
    case 'agents':
      return agentsSitemap();
    default:
      return [];
  }
}

// ─── Marketing ──────────────────────────────────────────────────────────────

function marketingSitemap(): MetadataRoute.Sitemap {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const now = new Date();
  const pair = (en: string, es: string) => ({
    en: `${site}${en}`,
    es: `${site}${es}`,
    'x-default': `${site}${en}`,
  });
  const entry = (
    enPath: string,
    esPath: string,
    priority: number,
    changeFrequency: 'yearly' | 'monthly' | 'weekly' | 'daily',
  ): MetadataRoute.Sitemap => [
    {
      url: `${site}${enPath}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: { languages: pair(enPath, esPath) },
    },
    {
      url: `${site}${esPath}`,
      lastModified: now,
      changeFrequency,
      priority,
      alternates: { languages: pair(enPath, esPath) },
    },
  ];

  return [
    ...entry('/en', '/es', 1.0, 'weekly'),
    ...entry('/en/pricing', '/es/precios', 0.7, 'monthly'),
    ...entry('/en/privacy', '/es/privacidad', 0.2, 'yearly'),
    ...entry('/en/terms', '/es/terminos', 0.2, 'yearly'),
    ...entry('/en/countries', '/es/paises', 0.6, 'daily'),
  ];
}

// ─── Properties (with image:image children) ─────────────────────────────────

async function propertiesSitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const supabase = await createServerSupabaseClient();

  const { data: rows, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, updated_at, published_at, status, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000); // sitemap protocol cap is 50k URLs per file

  if (error || !rows) return [];

  const cleanRows = rows.filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  // Batch-fetch images for all listings in this partition. Single round-trip
  // ordered by (property_id, position) so we can group + preserve display
  // order. Confirmed uploads only — the upload-status filter prevents
  // half-uploaded images from being announced to crawlers.
  const propertyIds = cleanRows.map((r) => r.id as string);
  const imagesByProperty = new Map<string, string[]>();
  if (propertyIds.length > 0) {
    const { data: imgRows } = await supabase
      .from('property_images')
      .select('property_id, cf_image_id, r2_key, position, upload_status')
      .in('property_id', propertyIds)
      .eq('upload_status', 'confirmed')
      .order('position', { ascending: true });

    for (const img of imgRows ?? []) {
      const url = buildImageUrl({
        cfImageId: (img.cf_image_id as string | null) ?? null,
        r2Key: (img.r2_key as string | null) ?? null,
        variant: 'public',
      });
      if (!url) continue;
      const pid = img.property_id as string;
      const arr = imagesByProperty.get(pid) ?? [];
      arr.push(url);
      imagesByProperty.set(pid, arr);
    }
  }

  const out: MetadataRoute.Sitemap = [];
  for (const row of cleanRows) {
    const enUrl = row.slug_en
      ? `${site}/en/properties/${row.slug_en}-${row.short_id}`
      : null;
    const esUrl = row.slug_es
      ? `${site}/es/propiedades/${row.slug_es}-${row.short_id}`
      : null;
    const lastMod = new Date(
      (row.updated_at as string) ?? (row.published_at as string),
    );
    const langs = {
      ...(enUrl ? { en: enUrl } : {}),
      ...(esUrl ? { es: esUrl } : {}),
      ...(enUrl ? { 'x-default': enUrl } : esUrl ? { 'x-default': esUrl } : {}),
    };
    const images = imagesByProperty.get(row.id as string);

    if (enUrl) {
      out.push({
        url: enUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: langs },
        ...(images && images.length > 0 ? { images } : {}),
      });
    }
    if (esUrl) {
      out.push({
        url: esUrl,
        lastModified: lastMod,
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: { languages: langs },
        ...(images && images.length > 0 ? { images } : {}),
      });
    }
  }

  return out;
}

// ─── Cities ─────────────────────────────────────────────────────────────────

async function citiesSitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const supabase = await createServerSupabaseClient();
  const now = new Date();

  const { data: rows } = await supabase
    .from('properties')
    .select('country_code, city, slug_en, slug_es, organizations!inner(slug)')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000);

  const clean = (rows ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const seen = new Map<string, { country: string; city: string }>();
  for (const r of clean) {
    if (!r.country_code || !r.city) continue;
    const key = `${r.country_code.toLowerCase()}/${citySlug(r.city)}`;
    if (!seen.has(key)) {
      seen.set(key, {
        country: r.country_code.toLowerCase(),
        city: citySlug(r.city),
      });
    }
  }

  const out: MetadataRoute.Sitemap = [];
  for (const { country, city } of seen.values()) {
    const enUrl = `${site}/en/properties-in/${country}/${city}`;
    const esUrl = `${site}/es/inmuebles-en/${country}/${city}`;
    out.push(
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
  return out;
}

// ─── Countries ──────────────────────────────────────────────────────────────

async function countriesSitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const supabase = await createServerSupabaseClient();
  const now = new Date();

  const { data: rows } = await supabase
    .from('properties')
    .select('country_code, slug_en, slug_es, organizations!inner(slug)')
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000);

  const clean = (rows ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const codes = new Set<string>();
  for (const r of clean) {
    if (r.country_code) codes.add(r.country_code.toLowerCase());
  }

  const out: MetadataRoute.Sitemap = [];
  for (const cc of codes) {
    const enUrl = `${site}/en/properties-in/${cc}`;
    const esUrl = `${site}/es/inmuebles-en/${cc}`;
    out.push(
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
  return out;
}

// ─── Agents ─────────────────────────────────────────────────────────────────

async function agentsSitemap(): Promise<MetadataRoute.Sitemap> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const supabase = await createServerSupabaseClient();
  const now = new Date();

  const { data: rows } = await supabase
    .from('properties')
    .select(
      'slug_en, slug_es, organizations!inner(slug, updated_at)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000);

  const clean = (rows ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  const seen = new Map<string, { slug: string; updatedAt: string | null }>();
  for (const r of clean) {
    const org = Array.isArray(r.organizations)
      ? r.organizations[0]
      : r.organizations;
    if (!org || typeof org !== 'object' || !('slug' in org)) continue;
    const slug = (org as { slug: string }).slug;
    if (!slug || seen.has(slug)) continue;
    seen.set(slug, {
      slug,
      updatedAt:
        ((org as { updated_at?: string | null }).updated_at as string | null) ??
        null,
    });
  }

  const out: MetadataRoute.Sitemap = [];
  for (const { slug, updatedAt } of seen.values()) {
    const enUrl = `${site}/en/agents/${slug}`;
    const esUrl = `${site}/es/agentes/${slug}`;
    const lastMod = updatedAt ? new Date(updatedAt) : now;
    out.push(
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
  return out;
}
