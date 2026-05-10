import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  buildImageEntriesForListing,
  MAX_IMAGES_PER_LISTING,
  type SitemapImageRow,
} from '@/lib/seo/image-sitemap';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Image sitemap — surfaced at `/sitemap-images.xml`.
 *
 * Per Google Image Sitemap protocol:
 * https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
 *
 * Each property URL gets one or more `<image:image>` children listing
 * its uploaded photos (capped at `MAX_IMAGES_PER_LISTING` — the hero +
 * a handful of room shots is enough; the gallery itself is crawlable
 * from the property page once Googlebot lands there). Google Image
 * Search uses these to surface property photos directly in image-search
 * results (Zillow / Redfin / Realtor pattern).
 *
 * Each `<image:image>` carries:
 *   - `<image:loc>`     — the Cloudflare Images `public` variant URL
 *                          (`https://imagedelivery.net/{hash}/{id}/public`),
 *                          or the R2 object URL when CF Images isn't
 *                          configured yet.
 *   - `<image:title>`   — the listing's locale-appropriate title (every
 *                          image gets some context, even on legacy
 *                          uploads with no alt text recorded).
 *   - `<image:caption>` — the per-image alt text in the URL's locale,
 *                          falling back to the other locale's alt text
 *                          when only one is filled in (pragmatic — a
 *                          cross-locale caption beats no caption for
 *                          image search).
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
  // Limit to MAX_IMAGES_PER_LISTING per property would require a
  // window-function query; cheaper to over-fetch a bit and let the
  // per-listing helper apply the cap.
  const propertyIds = cleanRows.map((r) => r.id);
  const imagesByProperty = new Map<string, SitemapImageRow[]>();
  if (propertyIds.length > 0) {
    const { data: imgRows } = await supabase
      .from('property_images')
      .select(
        'property_id, cf_image_id, r2_key, alt_text_en, alt_text_es, position, upload_status',
      )
      .in('property_id', propertyIds)
      .eq('upload_status', 'confirmed')
      .order('position', { ascending: true });

    for (const img of (imgRows ?? []) as Array<
      SitemapImageRow & { property_id: string; upload_status: string }
    >) {
      const arr = imagesByProperty.get(img.property_id) ?? [];
      // Bail early once we've collected enough for the cap. Saves
      // memory + serialization cost on listings with many photos.
      if (arr.length >= MAX_IMAGES_PER_LISTING) continue;
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
      const listingTitle = locale === 'es' ? row.title_es : row.title_en;

      const entries = buildImageEntriesForListing({
        images,
        locale,
        listingTitle: listingTitle ?? null,
      });
      if (entries.length === 0) continue;

      lines.push('  <url>');
      lines.push(`    <loc>${escapeXml(loc)}</loc>`);
      const lastMod = row.updated_at ?? row.published_at;
      if (lastMod) {
        lines.push(`    <lastmod>${escapeXml(lastMod)}</lastmod>`);
      }

      for (const entry of entries) {
        lines.push('    <image:image>');
        lines.push(`      <image:loc>${escapeXml(entry.loc)}</image:loc>`);
        if (entry.title) {
          lines.push(
            `      <image:title>${escapeXml(entry.title)}</image:title>`,
          );
        }
        if (entry.caption) {
          lines.push(
            `      <image:caption>${escapeXml(entry.caption)}</image:caption>`,
          );
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
