import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { TRANSACTION_TYPES } from '@/db/schema';

export const runtime = 'edge';

/**
 * GET /api/properties/by-bbox
 *
 * Lightweight, public, anon-readable endpoint backing the map view's
 * pan/zoom-driven re-fetch AND the synced list view. Given a bounding
 * box (south-west corner + north-east corner) plus optional filter
 * params, returns up to 200 active+published listings whose
 * denormalized lat/lng falls inside the box.
 *
 * Filter params mirror SearchFilters (`q`, `city`, `transaction`,
 * `min_price`, `max_price`, `beds_min`) so the bbox-driven result set
 * is consistent with what the search page would have shown for the
 * same filter state — just constrained to the visible viewport.
 *
 * Why axis-aligned bbox + denormalized lat/lng instead of PostGIS
 * `ST_Within(location, ST_MakeEnvelope(...))`: the lat/lng b-tree
 * indexes handle a `latitude BETWEEN sw_lat AND ne_lat AND longitude
 * BETWEEN sw_lng AND ne_lng` query directly. PostGIS only matters for
 * non-axis-aligned polygons or "within X km of point Y" queries —
 * neither is the map-pan case.
 *
 * Anti-meridian (longitude wrap-around at ±180°) is NOT handled —
 * if `sw_lng > ne_lng` we return an empty result. Out of scope for v1;
 * revisit when a non-Western-Hemisphere market opens.
 *
 * Test-fixture exclusion: `aho-test-org-*` org slug NOT LIKE filter via
 * inner join + defensive in-loop slug check on the listing slug. Same
 * belt-and-suspenders pattern as sitemap.ts and city-landing helper.
 *
 * Response shape: { listings: SearchListing[] } — full search-listing
 * shape (matches lib/listings/search.ts SearchListing interface) so the
 * list view can render ListingCard from these without losing fields
 * like bedrooms / image / area.
 *
 * Edge cache: `Cache-Control: public, max-age=60, s-maxage=60` because
 * listings change at most every few minutes (publish/unpublish), so
 * 60s edge caching pays for itself the moment two users browse the
 * same neighborhood.
 */

const QuerySchema = z.object({
  sw_lat: z.coerce.number().min(-90).max(90),
  sw_lng: z.coerce.number().min(-180).max(180),
  ne_lat: z.coerce.number().min(-90).max(90),
  ne_lng: z.coerce.number().min(-180).max(180),
  // Filter params — all optional (null/empty when absent).
  q: z.string().trim().min(1).max(200).optional(),
  city: z.string().trim().min(1).max(120).optional(),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  transaction: z.enum(TRANSACTION_TYPES).optional(),
  min_price: z.coerce.number().int().nonnegative().optional(),
  max_price: z.coerce.number().int().nonnegative().optional(),
  beds_min: z.coerce.number().int().min(0).max(20).optional(),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const parsed = QuerySchema.safeParse({
    sw_lat: sp.get('sw_lat'),
    sw_lng: sp.get('sw_lng'),
    ne_lat: sp.get('ne_lat'),
    ne_lng: sp.get('ne_lng'),
    q: sp.get('q') ?? undefined,
    city: sp.get('city') ?? undefined,
    country: sp.get('country') ?? undefined,
    transaction: sp.get('transaction') ?? undefined,
    min_price: sp.get('min_price') ?? undefined,
    max_price: sp.get('max_price') ?? undefined,
    beds_min: sp.get('beds_min') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_bbox', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { sw_lat, sw_lng, ne_lat, ne_lng } = parsed.data;

  // Validate ordering — sw must be south & west of ne. Anti-meridian
  // crossing falls into this branch; we return empty rather than
  // making clients special-case it.
  if (sw_lat > ne_lat || sw_lng > ne_lng) {
    return NextResponse.json({ listings: [] });
  }

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, featured_until, published_at, latitude, longitude, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .gte('latitude', sw_lat)
    .lte('latitude', ne_lat)
    .gte('longitude', sw_lng)
    .lte('longitude', ne_lng)
    .not('organizations.slug', 'like', 'aho-test-org-%');

  // Apply optional filter params identically to searchListings, so map +
  // list see the same rows for the same filter state.
  if (parsed.data.city) query = query.eq('city', parsed.data.city);
  if (parsed.data.country) query = query.eq('country_code', parsed.data.country);
  if (parsed.data.transaction)
    query = query.eq('transaction_type', parsed.data.transaction);
  if (parsed.data.min_price != null)
    query = query.gte('price_cents', parsed.data.min_price);
  if (parsed.data.max_price != null)
    query = query.lte('price_cents', parsed.data.max_price);
  if (parsed.data.beds_min != null)
    query = query.gte('bedrooms', parsed.data.beds_min);
  if (parsed.data.q) {
    // The `q` filter mirrors searchListings — title_en text-search.
    // We don't know the user's locale here so we always search title_en;
    // the search page passes its locale-specific `q` already, and Spanish
    // queries that don't match title_en just return zero. Acceptable for
    // bbox v1 since most queries are place names.
    query = query.textSearch('title_en', parsed.data.q, { type: 'plain' });
  }

  const { data, error } = await query
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    console.error('[by-bbox]', error);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  // Second pass: fetch primary images for the visible listings (same
  // pattern as searchListings).
  const rows = (data ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') &&
      !r.slug_es?.startsWith('aho-fixture-'),
  );
  const ids = rows.map((r) => r.id as string);
  let imageMap = new Map<string, string>();
  if (ids.length > 0) {
    const { data: imgs } = await supabase
      .from('property_images')
      .select('property_id, cf_image_id')
      .in('property_id', ids)
      .eq('is_primary', true)
      .eq('upload_status', 'confirmed');
    imageMap = new Map(
      (imgs ?? [])
        .filter((i) => i.cf_image_id)
        .map((i) => [i.property_id as string, i.cf_image_id as string]),
    );
  }

  const listings = rows.map((r) => ({
    id: r.id,
    shortId: r.short_id,
    slugEn: r.slug_en,
    slugEs: r.slug_es,
    titleEn: r.title_en,
    titleEs: r.title_es,
    transactionType: r.transaction_type,
    propertyType: r.property_type,
    priceCents: Number(r.price_cents),
    currency: r.currency,
    pricePeriod: r.price_period,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms != null ? Number(r.bathrooms) : null,
    areaSqm: r.area_sqm != null ? Number(r.area_sqm) : null,
    neighborhood: r.neighborhood,
    city: r.city,
    countryCode: r.country_code,
    imageCount: r.image_count,
    primaryImageId: imageMap.get(r.id) ?? null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  }));

  return NextResponse.json(
    { listings },
    {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    },
  );
}
