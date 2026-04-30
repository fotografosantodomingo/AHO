import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * GET /api/properties/by-bbox
 *
 * Lightweight, public, anon-readable endpoint for the map view's
 * pan/zoom-driven re-fetch. Given a bounding box (south-west corner +
 * north-east corner) returns up to 200 active+published listings whose
 * denormalized lat/lng falls inside the box.
 *
 * Why axis-aligned bbox + denormalized lat/lng instead of PostGIS
 * `ST_Within(location, ST_MakeEnvelope(...))`: the lat/lng columns
 * (populated by the trigger from migration 0007) carry b-tree indexes
 * via the existing `idx_properties_country_city`-style infra. A
 * `latitude BETWEEN sw_lat AND ne_lat AND longitude BETWEEN sw_lng AND
 * ne_lng` query can use those indexes directly. PostGIS would matter
 * for "within X km of point Y" or for non-axis-aligned polygons —
 * neither is the common map-pan case.
 *
 * Anti-meridian (longitude wrap-around at ±180°) is NOT handled here.
 * If the bounds cross the date line we return an empty result. Real
 * cross-meridian browsing (e.g., Pacific markets from a wide-zoomed
 * map) will need a query split — out of scope for v1; we'll add when
 * a non-Western-Hemisphere market opens.
 *
 * Response shape: { listings: SearchListingMapRow[] } — a tighter
 * projection than the SearchListing interface (just the fields the
 * map needs: id, shortId, title, slugs, price, currency, lat, lng,
 * city, countryCode).
 *
 * Test-fixture exclusion via `aho-test-org-*` org slug NOT LIKE filter
 * (same belt-and-suspenders pattern as sitemap.ts and city landing).
 */

const QuerySchema = z.object({
  sw_lat: z.coerce.number().min(-90).max(90),
  sw_lng: z.coerce.number().min(-180).max(180),
  ne_lat: z.coerce.number().min(-90).max(90),
  ne_lng: z.coerce.number().min(-180).max(180),
});

interface MapListingRow {
  id: string;
  shortId: string;
  slugEn: string | null;
  slugEs: string | null;
  titleEn: string | null;
  titleEs: string | null;
  priceCents: number;
  currency: string;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    sw_lat: url.searchParams.get('sw_lat'),
    sw_lng: url.searchParams.get('sw_lng'),
    ne_lat: url.searchParams.get('ne_lat'),
    ne_lng: url.searchParams.get('ne_lng'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_bbox', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { sw_lat, sw_lng, ne_lat, ne_lng } = parsed.data;

  // Validate ordering — sw must be south & west of ne.
  if (sw_lat > ne_lat || sw_lng > ne_lng) {
    // Anti-meridian crossing falls into this branch; we return an empty
    // result rather than the more honest "cross-meridian unsupported"
    // because clients shouldn't have to special-case this.
    return NextResponse.json({ listings: [] });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, price_cents, currency, city, country_code, latitude, longitude, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .gte('latitude', sw_lat)
    .lte('latitude', ne_lat)
    .gte('longitude', sw_lng)
    .lte('longitude', ne_lng)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) {
    console.error('[by-bbox]', error);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  const listings: MapListingRow[] = (data ?? [])
    .filter(
      (r) =>
        !r.slug_en?.startsWith('aho-fixture-') &&
        !r.slug_es?.startsWith('aho-fixture-') &&
        r.latitude != null &&
        r.longitude != null,
    )
    .map((r) => ({
      id: r.id,
      shortId: r.short_id,
      slugEn: r.slug_en,
      slugEs: r.slug_es,
      titleEn: r.title_en,
      titleEs: r.title_es,
      priceCents: Number(r.price_cents),
      currency: r.currency,
      city: r.city,
      countryCode: r.country_code,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
    }));

  return NextResponse.json(
    { listings },
    {
      // 60s edge cache — the response is keyed by bbox so we get cache hits
      // for users panning over the same neighborhoods. Listings change at
      // most every few minutes (publish/unpublish), so 60s is fine.
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    },
  );
}
