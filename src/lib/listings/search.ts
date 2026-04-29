import 'server-only';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { TRANSACTION_TYPES } from '@/db/schema';
import type { Locale } from '@/i18n/config';

/**
 * Search filter parsing + querying for the public browse page.
 *
 * Filters live in URL search params so results are shareable and SEO-friendly.
 * Bad inputs are dropped silently rather than throwing — a query like
 * `?min_price=foo` should still render the unfiltered grid, not 500.
 */

export const PAGE_SIZE = 24;

const TransactionSchema = z.enum(TRANSACTION_TYPES);

export interface SearchFilters {
  q: string | null;
  city: string | null;
  transaction: (typeof TRANSACTION_TYPES)[number] | null;
  minPrice: number | null;
  maxPrice: number | null;
  bedsMin: number | null;
  page: number;
}

export function parseFilters(searchParams: URLSearchParams | Record<string, string | string[] | undefined>): SearchFilters {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key);
    const raw = (searchParams as Record<string, string | string[] | undefined>)[key];
    if (Array.isArray(raw)) return raw[0] ?? null;
    return raw ?? null;
  };

  const num = (s: string | null) => {
    if (s == null) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const transaction = TransactionSchema.safeParse(get('transaction'));
  const pageRaw = num(get('page')) ?? 1;
  const page = Math.max(1, Math.min(pageRaw, 999));

  const cityRaw = get('city')?.trim() ?? null;
  const qRaw = get('q')?.trim() ?? null;

  return {
    q: qRaw && qRaw.length > 0 && qRaw.length <= 200 ? qRaw : null,
    city: cityRaw && cityRaw.length > 0 && cityRaw.length <= 120 ? cityRaw : null,
    transaction: transaction.success ? transaction.data : null,
    minPrice: num(get('min_price')),
    maxPrice: num(get('max_price')),
    bedsMin: num(get('beds_min')),
    page,
  };
}

export interface SearchListing {
  id: string;
  shortId: string;
  slugEn: string | null;
  slugEs: string | null;
  titleEn: string | null;
  titleEs: string | null;
  transactionType: string;
  propertyType: string;
  priceCents: number;
  currency: string;
  pricePeriod: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  neighborhood: string | null;
  city: string;
  countryCode: string;
  imageCount: number;
  /** Primary image's CF Image ID, if a confirmed primary exists. */
  primaryImageId: string | null;
}

export interface SearchResult {
  listings: SearchListing[];
  /** True if there is likely a next page (we got a full pageSize back). */
  hasMore: boolean;
}

export async function searchListings(
  filters: SearchFilters,
  locale: Locale,
): Promise<SearchResult> {
  const supabase = await createServerSupabaseClient();
  const offset = (filters.page - 1) * PAGE_SIZE;

  let query = supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, featured_until, published_at',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null);

  if (filters.city) query = query.eq('city', filters.city);
  if (filters.transaction) query = query.eq('transaction_type', filters.transaction);
  if (filters.minPrice != null) query = query.gte('price_cents', filters.minPrice);
  if (filters.maxPrice != null) query = query.lte('price_cents', filters.maxPrice);
  if (filters.bedsMin != null) query = query.gte('bedrooms', filters.bedsMin);
  if (filters.q) {
    // Per-locale full-text search using the GIN tsvector indexes from 0004.
    const column = locale === 'es' ? 'title_es' : 'title_en';
    query = query.textSearch(column, filters.q, { type: 'plain' });
  }

  query = query
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + PAGE_SIZE);

  const { data, error } = await query;
  if (error) {
    console.error('[searchListings]', error);
    return { listings: [], hasMore: false };
  }

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  // Second pass: fetch primary images for the visible listings.
  const ids = sliced.map((r) => r.id);
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

  return {
    listings: sliced.map((r) => ({
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
    })),
    hasMore,
  };
}

/**
 * Build a search-page URL with the given filter state, preserving locale
 * routing. Used by pagination links and "clear filter" CTAs.
 */
export function buildSearchUrl(
  locale: Locale,
  filters: Partial<SearchFilters>,
): string {
  const path = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.city) params.set('city', filters.city);
  if (filters.transaction) params.set('transaction', filters.transaction);
  if (filters.minPrice != null) params.set('min_price', String(filters.minPrice));
  if (filters.maxPrice != null) params.set('max_price', String(filters.maxPrice));
  if (filters.bedsMin != null) params.set('beds_min', String(filters.bedsMin));
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
