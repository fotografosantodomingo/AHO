import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { SearchListing } from './search';

/**
 * Similar-homes finder for the property detail page.
 *
 * Definition of "similar":
 *   - Same `country_code` AND same `city` (case-insensitive)
 *   - Same `transaction_type` (sale ↔ sale, rent ↔ rent — never crossed)
 *   - Price within ±20% of the source listing
 *   - status='active' AND published_at IS NOT NULL
 *   - Excludes the source listing itself
 *   - Limit 6 (carousel size)
 *   - Order: featured_until desc nulls last, then published_at desc
 *
 * Worldwide-shaped: relies on the existing city/country denorm + the
 * transaction_type enum. No country-specific tuning. Markets with sparse
 * inventory will see fewer results — that's honest emptiness; we don't
 * widen the price band or relax city to fill the carousel.
 *
 * Test-fixture exclusion: inner-joins organizations with the
 * `aho-test-org-%` slug filter, same belt-and-suspenders pattern as
 * sitemap.ts and city-landing helper.
 */

interface FindArgs {
  selfId: string;
  city: string;
  countryCode: string;
  transactionType: 'sale' | 'rent' | 'short_term';
  priceCents: number;
}

export async function findSimilarListings(args: FindArgs): Promise<SearchListing[]> {
  const supabase = await createServerSupabaseClient();
  const minPrice = Math.floor(args.priceCents * 0.8);
  const maxPrice = Math.ceil(args.priceCents * 1.2);

  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, featured_until, published_at, latitude, longitude, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .eq('country_code', args.countryCode.toUpperCase())
    .ilike('city', args.city)
    .eq('transaction_type', args.transactionType)
    .gte('price_cents', minPrice)
    .lte('price_cents', maxPrice)
    .neq('id', args.selfId)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(6);

  if (error) {
    console.error('[findSimilarListings]', error);
    return [];
  }

  // Defensive fixture-slug filter — same belt-and-suspenders the city
  // landing helper uses.
  const filtered = (data ?? []).filter(
    (r) =>
      !(r.slug_en as string | null)?.startsWith('aho-fixture-') &&
      !(r.slug_es as string | null)?.startsWith('aho-fixture-'),
  );

  // Second pass: primary images for the visible listings.
  const ids = filtered.map((r) => r.id as string);
  const imageMap = new Map<string, { cfImageId: string | null; r2Key: string | null }>();
  if (ids.length > 0) {
    const { data: imgs } = await supabase
      .from('property_images')
      .select('property_id, cf_image_id, r2_key')
      .in('property_id', ids)
      .eq('is_primary', true)
      .eq('upload_status', 'confirmed');
    for (const i of imgs ?? []) {
      imageMap.set(i.property_id as string, {
        cfImageId: (i.cf_image_id as string | null) ?? null,
        r2Key: (i.r2_key as string | null) ?? null,
      });
    }
  }

  return filtered.map((r) => ({
    id: r.id as string,
    shortId: r.short_id as string,
    slugEn: (r.slug_en as string | null) ?? null,
    slugEs: (r.slug_es as string | null) ?? null,
    titleEn: (r.title_en as string | null) ?? null,
    titleEs: (r.title_es as string | null) ?? null,
    transactionType: r.transaction_type as 'sale' | 'rent' | 'short_term',
    propertyType: r.property_type as string,
    priceCents: Number(r.price_cents),
    currency: r.currency as string,
    pricePeriod: (r.price_period as 'total' | 'monthly' | 'weekly' | 'nightly' | null) ?? null,
    bedrooms: (r.bedrooms as number | null) ?? null,
    bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
    areaSqm: r.area_sqm != null ? Number(r.area_sqm) : null,
    neighborhood: (r.neighborhood as string | null) ?? null,
    city: r.city as string,
    countryCode: r.country_code as string,
    imageCount: (r.image_count as number | null) ?? 0,
    primaryImageId: imageMap.get(r.id as string)?.cfImageId ?? null,
    primaryR2Key: imageMap.get(r.id as string)?.r2Key ?? null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  }));
}
