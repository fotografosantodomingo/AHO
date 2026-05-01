import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SearchListing } from './search';

/**
 * Server-side helper: given the signed-in user (or null) and a set of
 * property IDs visible on the current page, return the subset that the
 * user has favorited. Used to pre-render the heart-filled state on
 * listing cards + property detail without a per-card client-side fetch.
 *
 * Returns an empty Set when:
 *   - user is null (anon)
 *   - propertyIds is empty
 *   - the lookup errors (logged; never throws)
 *
 * The query is RLS-gated by `property_favorites_self_select` so a single
 * `.in('property_id', ids)` filter is enough — the policy adds the
 * implicit `user_id = auth.uid()` clause server-side.
 */
export async function getUserFavoriteIds(
  supabase: SupabaseClient,
  userId: string | null,
  propertyIds: readonly string[],
): Promise<Set<string>> {
  if (!userId || propertyIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('property_favorites')
    .select('property_id')
    .eq('user_id', userId)
    .in('property_id', propertyIds as string[]);
  if (error) {
    console.warn('[favorites] lookup failed', error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.property_id as string));
}

/**
 * Fetch the signed-in user's saved properties as full SearchListing
 * shapes — for the /dashboard/saved-properties page. Only returns
 * listings still active+published (archived/sold ones are filtered
 * out at the join; the row remains in property_favorites though, so
 * if a listing comes back online, it reappears in the saved list).
 *
 * RLS gates by user_id = auth.uid() automatically.
 */
export async function fetchSavedProperties(
  supabase: SupabaseClient,
  userId: string,
): Promise<SearchListing[]> {
  // Two-step: read the favorites + property base columns in one inner-
  // join, then second-pass to attach the primary image. Mirrors the
  // pattern in `searchListings` (keeping JOIN graphs simple is what
  // makes the RLS policy + PostgREST work cleanly here).
  const { data, error } = await supabase
    .from('property_favorites')
    .select(
      `
      created_at,
      property:properties!inner (
        id, short_id, slug_en, slug_es, title_en, title_es,
        transaction_type, property_type, price_cents, currency, price_period,
        bedrooms, bathrooms, area_sqm, neighborhood, city, country_code,
        image_count, latitude, longitude, status, published_at
      )
      `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.warn('[favorites] fetch saved failed', error);
    return [];
  }

  type Row = {
    created_at: string;
    property: {
      id: string;
      short_id: string;
      slug_en: string | null;
      slug_es: string | null;
      title_en: string | null;
      title_es: string | null;
      transaction_type: string;
      property_type: string;
      price_cents: number;
      currency: string;
      price_period: string | null;
      bedrooms: number | null;
      bathrooms: number | null;
      area_sqm: number | null;
      neighborhood: string | null;
      city: string;
      country_code: string;
      image_count: number;
      latitude: number | null;
      longitude: number | null;
      status: string;
      published_at: string | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  const visible = rows
    .map((r) => r.property)
    .filter(
      (p): p is NonNullable<typeof p> =>
        !!p && p.status === 'active' && !!p.published_at,
    );
  if (visible.length === 0) return [];

  // Second pass: attach the primary image for each visible favorite.
  const ids = visible.map((p) => p.id);
  const { data: images } = await supabase
    .from('property_images')
    .select('property_id, cf_image_id, r2_key')
    .in('property_id', ids)
    .eq('is_primary', true)
    .eq('upload_status', 'confirmed');
  type ImageRow = {
    property_id: string;
    cf_image_id: string | null;
    r2_key: string | null;
  };
  const imgByProp = new Map<string, ImageRow>(
    ((images ?? []) as ImageRow[]).map((i) => [i.property_id, i]),
  );

  return visible.map<SearchListing>((p) => {
    const img = imgByProp.get(p.id);
    return {
      id: p.id,
      shortId: p.short_id,
      slugEn: p.slug_en,
      slugEs: p.slug_es,
      titleEn: p.title_en,
      titleEs: p.title_es,
      transactionType: p.transaction_type,
      propertyType: p.property_type,
      priceCents: p.price_cents,
      currency: p.currency,
      pricePeriod: p.price_period,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      areaSqm: p.area_sqm,
      neighborhood: p.neighborhood,
      city: p.city,
      countryCode: p.country_code,
      imageCount: p.image_count,
      primaryImageId: img?.cf_image_id ?? null,
      primaryR2Key: img?.r2_key ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
    };
  });
}
