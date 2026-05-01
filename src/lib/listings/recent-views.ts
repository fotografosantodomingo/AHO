import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locale } from '@/i18n/config';
import type { SearchListing } from './search';

/**
 * Server-side helpers for the "Recently viewed" feature
 * (feat/recently-viewed, migration 0025).
 *
 * Identity model:
 *   - Authenticated user → user_id is auth.users.id (cross-device).
 *   - Anonymous visitor  → anonymous_id is the UUID stored in the
 *     `aho_anon_id` cookie. Per-browser, persists 1 year.
 *
 * Writes are server-mediated via the admin client through the
 * /api/properties/[id]/view route. No client-side direct DB writes.
 *
 * Reads happen on the rail-rendering Server Component side, also via
 * the admin client (anon visitors have no auth context for RLS to gate).
 *
 * Dedup: an UPSERT against the partial-unique index per visitor —
 * re-viewing a property refreshes `viewed_at`, doesn't add a row.
 */

export const ANON_COOKIE_NAME = 'aho_anon_id';

interface RecordViewArgs {
  supabase: SupabaseClient;
  propertyId: string;
  userId: string | null;
  anonymousId: string | null;
  locale: Locale;
  sourcePath: string | null;
}

/**
 * Insert-or-update a row in property_recent_views for the current
 * visitor. Conflict target depends on which identity field is set:
 * `(user_id, property_id)` if user_id is non-null, else
 * `(anonymous_id, property_id)`. Both indexes are partial-unique so
 * the upsert lands on whichever applies.
 *
 * Returns silently on error — view tracking is best-effort and never
 * breaks page render.
 */
export async function recordPropertyView({
  supabase,
  propertyId,
  userId,
  anonymousId,
  locale,
  sourcePath,
}: RecordViewArgs): Promise<void> {
  if (!userId && !anonymousId) return;

  // Goes through the SECURITY DEFINER record_property_view RPC
  // (migration 0026) — PostgREST's .upsert() can't target the partial
  // unique indexes that gate per-visitor uniqueness. The RPC dispatches
  // the right INSERT … ON CONFLICT … WHERE branch based on which
  // identity field is set.
  const { error } = await supabase.rpc('record_property_view', {
    p_user_id: userId,
    p_anonymous_id: anonymousId,
    p_property_id: propertyId,
    p_locale: locale,
    p_source_path: sourcePath,
  });
  if (error) {
    console.warn('[recent-views] rpc failed', error);
  }
}

interface GetRecentArgs {
  supabase: SupabaseClient;
  userId: string | null;
  anonymousId: string | null;
  /** Property ID to exclude from the rail (e.g. "don't show the
   *  property the user is currently looking at on its own detail page"). */
  excludeId?: string | null;
  limit?: number;
}

/**
 * Fetch the current visitor's most-recent N views as full SearchListing
 * shapes. Filters to active+published properties only (a row pointing
 * at an archived/sold listing stays in the table but disappears from
 * the rail until it's republished).
 *
 * Identity precedence: if `userId` is set, query by user_id; otherwise
 * by anonymous_id. (We don't merge the two — that'd require post-signup
 * backfill, deferred.)
 */
export async function getRecentViews({
  supabase,
  userId,
  anonymousId,
  excludeId = null,
  limit = 8,
}: GetRecentArgs): Promise<SearchListing[]> {
  if (!userId && !anonymousId) return [];

  const filterColumn = userId ? 'user_id' : 'anonymous_id';
  const filterValue = userId ?? anonymousId!;

  const query = supabase
    .from('property_recent_views')
    .select(
      `
      property:properties!inner (
        id, short_id, slug_en, slug_es, title_en, title_es,
        transaction_type, property_type, price_cents, currency, price_period,
        bedrooms, bathrooms, area_sqm, neighborhood, city, country_code,
        image_count, latitude, longitude, status, published_at
      ),
      viewed_at
      `,
    )
    .eq(filterColumn, filterValue)
    .order('viewed_at', { ascending: false })
    .limit(limit * 2); // overfetch — some rows may filter out (archived/sold)

  const { data, error } = await query;
  if (error) {
    console.warn('[recent-views] fetch failed', error);
    return [];
  }

  type Row = {
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
    viewed_at: string;
  };

  const rows = (data ?? []) as unknown as Row[];
  const visible = rows
    .map((r) => r.property)
    .filter(
      (p): p is NonNullable<typeof p> =>
        !!p && p.status === 'active' && !!p.published_at,
    )
    .filter((p) => p.id !== excludeId)
    .slice(0, limit);
  if (visible.length === 0) return [];

  // Second pass: primary image attach. Mirrors fetchSavedProperties.
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
