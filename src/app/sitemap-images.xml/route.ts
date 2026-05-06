import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { buildImageUrl } from '@/lib/listings/image-url';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Image sitemap — surfaced at `/sitemap-images.xml`.
 *
 * Per Google Image Sitemap protocol:
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
 *
 * Each property URL gets one or more `<image:image>` children listing its
 * uploaded photos. Google Image Search uses these to surface property
 * photos directly in image-search results (Zillow / Redfin / Realtor pattern).
 *
 * **Manual XML route (not Next.js's `generateSitemaps()`)** — the typed
 * sitemap-index API requires Node runtime via `generateStaticParams()`,
 * which is incompatible with Cloudflare Pages' edge-only runtime. A
 * route handler returning a hand-built XML string sidesteps that
 * entirely. Bug logged 2026-05-01: smart sitemap reverted because
 * `generateSitemaps()` broke the deploy. This file does the same job
 * (image sitemap with `<image:image>` children) without touching that
 * API.
 *
 * Same fixture-exclusion rules as the main sitemap — `aho-test-org-*`
 * org slugs + `aho-fixture-*` listing slugs are filtered out at both
 * layers (CLAUDE.md hard rule #8).
 *
 * The robots.txt at `/robots.txt` references this URL so Google
 * discovers it alongside the main sitemap.
 *
 * Caches: none. Streams from Supabase per-request (`force-dynamic`).
 * The data is small (one row per property + per image; capped at
 * 50K URLs per the protocol), and we want fresh image lists the
 * moment an agent uploads.
 */

interface PropertyRow {
  id: string;
  short_id: string;
  slug_en: string | null;
  slug_es: string | null;
  updated_at: string | null;
  published_at: string | null;
  title_en: string | null;
  title_es: string | null;
  city: string | null;
  country_code: string | null;
  organizations: { slug: string } | { slug: string }[] | null;
}

interface ImageRow {
  property_id: string;
  cf_image_id: string | null;
  r2_key: string | null;
  alt_text_en: string | null;
  alt_text_es: string | null;
  position: number;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function GET(): Promise<Response> {
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const supabase = await createServerSupabaseClient();

  const { data: rows } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, updated_at, published_at, title_en, title_es, city, country_code, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .limit(50_000);

  const cleanRows = ((rows ?? []) as PropertyRow[]).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );

  // Batch-fetch images for all listings in this set. Confirmed only.
  const propertyIds = cleanRows.map((r) => r.id);
  const imagesByProperty = new Map<string, ImageRow[]>();
  if (propertyIds.length > 0) {
    const { data: imgRows } = await supabase
      .from('property_images')
      .select(
        'property_id, cf_image_id, r2_key, alt_text_en, alt_text_es, position, upload_status',
      )
      .in('property_id', propertyIds)
      .eq('upload_status', 'confirmed')
      .order('position', { ascending: true });

    for (const img of (imgRows ?? []) as (ImageRow & {
      upload_status: string;
    })[]) {
      const arr = imagesByProperty.get(img.property_id) ?? [];
      arr.push(img);
      imagesByProperty.set(img.property_id, arr);
    }
  }

  // Build XML. Each property URL emits one `<url>` per locale with its
  // images as children.
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
  ];

  for (const row of cleanRows) {
    const images = imagesByProperty.get(row.id) ?? [];
    if (images.length === 0) continue;

    for (const locale of ['en', 'es'] as const) {
      const slug = locale === 'es' ? row.slug_es : row.slug_en;
      if (!slug) continue;
      const path = locale === 'es' ? 'propiedades' : 'properties';
      const loc = `${site}/${locale}/${path}/${slug}-${row.short_id}`;

      lines.push('  <url>');
      lines.push(`    <loc>${escapeXml(loc)}</loc>`);
      const lastMod = row.updated_at ?? row.published_at;
      if (lastMod) {
        lines.push(`    <lastmod>${escapeXml(lastMod)}</lastmod>`);
      }

      for (const img of images) {
        const url = buildImageUrl({
          cfImageId: img.cf_image_id,
          r2Key: img.r2_key,
          variant: 'public',
        });
        if (!url) continue;
        const alt =
          (locale === 'es' ? img.alt_text_es : img.alt_text_en) ??
          img.alt_text_en ??
          img.alt_text_es ??
          ((locale === 'es' ? row.title_es : row.title_en) ?? '');
        lines.push('    <image:image>');
        lines.push(`      <image:loc>${escapeXml(url)}</image:loc>`);
        if (alt) {
          lines.push(`      <image:caption>${escapeXml(alt)}</image:caption>`);
        }
        lines.push('    </image:image>');
      }

      lines.push('  </url>');
    }
  }

  lines.push('</urlset>');

  return new Response(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=600',
    },
  });
}
