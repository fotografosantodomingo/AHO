import 'server-only';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TRANSACTION_TYPES } from '@/db/schema';
import type { Locale } from '@/i18n/config';

interface PrimaryImage {
  cfImageId: string | null;
  r2Key: string | null;
}

/**
 * Fetch the primary image (cf_image_id + r2_key) for a batch of property
 * IDs. Returns a Map keyed by property_id; missing entries are properties
 * without a confirmed primary image. Used by all three search-result
 * helpers (search / city landing / agent profile).
 */
async function fetchPrimaryImageMap(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<Map<string, PrimaryImage>> {
  if (propertyIds.length === 0) return new Map();
  const { data: imgs } = await supabase
    .from('property_images')
    .select('property_id, cf_image_id, r2_key')
    .in('property_id', propertyIds)
    .eq('is_primary', true)
    .eq('upload_status', 'confirmed');
  const map = new Map<string, PrimaryImage>();
  for (const i of imgs ?? []) {
    map.set(i.property_id as string, {
      cfImageId: (i.cf_image_id as string | null) ?? null,
      r2Key: (i.r2_key as string | null) ?? null,
    });
  }
  return map;
}

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
  /** Uppercased ISO-3166-1 alpha-2 country code (US, MX, DO, ES, …). */
  country: string | null;
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
  const countryRaw = get('country')?.trim().toUpperCase() ?? null;
  // Strict 2-letter ISO. Drop anything else silently rather than 500.
  const country =
    countryRaw && /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : null;

  return {
    q: qRaw && qRaw.length > 0 && qRaw.length <= 200 ? qRaw : null,
    city: cityRaw && cityRaw.length > 0 && cityRaw.length <= 120 ? cityRaw : null,
    country,
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
  /** Primary image's R2 object key, fallback for rendering when CF
   *  Images isn't configured yet. Listing-card prefers cf_image_id when
   *  both are present. */
  primaryR2Key: string | null;
  /** Denormalized lat/lng (from migration 0007 trigger). Used by the
   *  map view; null if location wasn't set or the trigger hasn't run. */
  latitude: number | null;
  longitude: number | null;
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
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, featured_until, published_at, latitude, longitude',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null);

  if (filters.city) query = query.eq('city', filters.city);
  if (filters.country) query = query.eq('country_code', filters.country);
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

  // Second pass: fetch primary images (both cf_image_id and r2_key) for
  // the visible listings.
  const ids = sliced.map((r) => r.id);
  const imageMap = await fetchPrimaryImageMap(supabase, ids);

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
      primaryImageId: imageMap.get(r.id)?.cfImageId ?? null,
    primaryR2Key: imageMap.get(r.id)?.r2Key ?? null,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
    })),
    hasMore,
  };
}

/**
 * Convert a city URL slug back to a human-readable city query string.
 * "santo-domingo" → "santo domingo". The DB query uses ILIKE so case +
 * spelling variants ("Santo Domingo", "santo domingo", "SANTO DOMINGO")
 * all match.
 */
export function citySlugToQuery(slug: string): string {
  return slug.replace(/-+/g, ' ').trim();
}

/**
 * Convert a city name to a URL slug. Inverse of citySlugToQuery, used
 * when building city-landing-page URLs from listing data.
 *
 * Lowercase, ASCII-only, hyphenated. Not unaccent-aware (Postgres unaccent
 * extension isn't enabled yet); São Paulo would slug to "so-paulo" which
 * is wrong. When we onboard a non-ASCII market, install unaccent and
 * revisit.
 */
export function citySlug(city: string): string {
  return city
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface CityLandingArgs {
  countryCode: string; // uppercased 2-letter ISO
  citySlug: string;    // hyphenated lowercase
  locale: Locale;
  limit?: number;
}

interface CityLandingResult {
  listings: SearchListing[];
  totalShown: number;
  hasMore: boolean;
  resolvedCity: string | null; // canonical city name from the DB (or null if no listings)
}

/**
 * Listings for the city landing page at `/{locale}/properties-in/{country}/{city}`.
 *
 * Differences from `searchListings`:
 *   - No pagination — landing pages show a top-N grid with "see more" CTA.
 *   - Filters by `country_code` (uppercased) AND `city` ILIKE the slug.
 *   - Excludes RLS test fixtures (org slug LIKE `aho-test-org-%` or
 *     listing slug LIKE `aho-fixture-%`) per CLAUDE.md hard rule #8 and
 *     "Local-dev quirks". Same belt-and-suspenders pattern as sitemap.ts.
 *   - Returns the canonical city name from the first matched row so the
 *     page can render `${city}, ${country}` in proper case ("Santo Domingo"
 *     even when the URL slug is `santo-domingo`).
 */
export async function searchCityLanding(
  args: CityLandingArgs,
): Promise<CityLandingResult> {
  const supabase = await createServerSupabaseClient();
  const cityQuery = citySlugToQuery(args.citySlug);
  const limit = args.limit ?? 30;

  const { data, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, featured_until, published_at, latitude, longitude, organizations!inner(slug)',
    )
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .eq('country_code', args.countryCode.toUpperCase())
    .ilike('city', cityQuery)
    .not('organizations.slug', 'like', 'aho-test-org-%')
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(0, limit); // limit + 1 to detect hasMore

  if (error) {
    console.error('[searchCityLanding]', error);
    return { listings: [], totalShown: 0, hasMore: false, resolvedCity: null };
  }

  const rows = (data ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') && !r.slug_es?.startsWith('aho-fixture-'),
  );
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  // Second pass: fetch primary images (cf_image_id + r2_key) for the visible listings.
  const ids = sliced.map((r) => r.id as string);
  const imageMap = await fetchPrimaryImageMap(supabase, ids);

  const listings: SearchListing[] = sliced.map((r) => ({
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
    primaryImageId: imageMap.get(r.id)?.cfImageId ?? null,
    primaryR2Key: imageMap.get(r.id)?.r2Key ?? null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  }));

  return {
    listings,
    totalShown: listings.length,
    hasMore,
    resolvedCity: listings[0]?.city ?? null,
  };
}

interface AgentProfileArgs {
  orgSlug: string;
  locale: Locale;
  limit?: number;
}

interface AgentProfile {
  name: string;
  slug: string;
  type: 'agent' | 'agency' | 'expert';
  descriptionEn: string | null;
  descriptionEs: string | null;
  headquartersCountry: string | null;
  headquartersCity: string | null;
  website: string | null;
  logoUrl: string | null;
}

/**
 * Public agent identity — fields from `profiles` we surface on the
 * agent profile page. Phone numbers are NOT exposed here (they only
 * surface via the SECURITY DEFINER `get_listing_contact` RPC, which
 * only returns them for active+published listings).
 */
export interface PublicAgentProfile {
  fullName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  specialties: string[];
  languagesSpoken: string[];
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
  /** Cached stats — recomputed by trigger on every status flip. */
  statsTotalSales: number;
  statsSales12mo: number;
  statsPriceMinCents: number | null;
  statsPriceMaxCents: number | null;
  statsAvgPriceCents: number | null;
}

export interface SoldListing extends SearchListing {
  soldDate: string | null;
  soldPriceCents: number | null;
  representedSide: 'buyer' | 'seller' | 'both' | null;
}

interface AgentProfileResult {
  org: AgentProfile | null;
  /** The org's first owner — the human behind the brokerage. v1 is
   *  one-agent-per-org, so this is "the agent" for now. v1.1 multi-
   *  agent orgs will need a different surface. */
  agent: PublicAgentProfile | null;
  /** Active+published listings. */
  listings: SearchListing[];
  /** Listings with status = sold or rented (for the Sold table + Recent
   *  Sales carousel). Sorted by sold_date desc. */
  soldListings: SoldListing[];
  totalShown: number;
  hasMore: boolean;
}

/**
 * Org profile + their active+published listings, for the public
 * `/{locale}/agents/{slug}` page.
 *
 * Returns `org: null` if no org matches the slug or the slug looks like
 * a test fixture (`aho-test-org-*`). Caller should `notFound()` on null
 * — we don't 404 here so the caller can render its own SEO metadata for
 * the not-found state.
 *
 * Listings filter: same fixture-exclusion pattern as sitemap and the
 * city-landing helper. Per CLAUDE.md hard rule #8 + "Local-dev quirks".
 */
export async function fetchAgentProfile(
  args: AgentProfileArgs,
): Promise<AgentProfileResult> {
  const supabase = await createServerSupabaseClient();
  const limit = args.limit ?? 30;

  // Refuse to surface fixture orgs publicly. The sitemap helper inner-joins;
  // here we just early-return because no real user should ever land on an
  // /agents/aho-test-org-a URL — the slug is enough signal.
  if (args.orgSlug.startsWith('aho-test-org-')) {
    return {
      org: null,
      agent: null,
      listings: [],
      soldListings: [],
      totalShown: 0,
      hasMore: false,
    };
  }

  const { data: orgRow, error: orgErr } = await supabase
    .from('organizations')
    .select(
      'id, name, slug, type, description_en, description_es, headquarters_country, headquarters_city, website, logo_url',
    )
    .eq('slug', args.orgSlug)
    .maybeSingle();

  if (orgErr || !orgRow) {
    return {
      org: null,
      agent: null,
      listings: [],
      soldListings: [],
      totalShown: 0,
      hasMore: false,
    };
  }

  const org: AgentProfile = {
    name: orgRow.name,
    slug: orgRow.slug,
    type: orgRow.type,
    descriptionEn: orgRow.description_en,
    descriptionEs: orgRow.description_es,
    headquartersCountry: orgRow.headquarters_country,
    headquartersCity: orgRow.headquarters_city,
    website: orgRow.website,
    logoUrl: orgRow.logo_url,
  };

  // Resolve the org's owner (the "agent" for v1 — single-owner-per-org).
  // We need their profile fields for bio/specialties/socials/stats and
  // their id to scope the listings query (using created_by). v1.1
  // multi-agent will switch this to all members.
  const { data: ownerRow } = await supabase
    .from('organization_members')
    .select('user_id, profiles!inner(full_name, avatar_url, bio, specialties, languages_spoken, website_url, facebook_url, instagram_url, linkedin_url, stats_total_sales, stats_sales_12mo, stats_price_min_cents, stats_price_max_cents, stats_avg_price_cents)')
    .eq('org_id', orgRow.id)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();

  type OwnerProfile = {
    full_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    specialties: string[] | null;
    languages_spoken: string[] | null;
    website_url: string | null;
    facebook_url: string | null;
    instagram_url: string | null;
    linkedin_url: string | null;
    stats_total_sales: number;
    stats_sales_12mo: number;
    stats_price_min_cents: number | null;
    stats_price_max_cents: number | null;
    stats_avg_price_cents: number | null;
  };
  const ownerProfileRaw = ownerRow?.profiles as OwnerProfile | OwnerProfile[] | null | undefined;
  const ownerProfile = Array.isArray(ownerProfileRaw) ? ownerProfileRaw[0] ?? null : ownerProfileRaw ?? null;
  const agent: PublicAgentProfile | null = ownerProfile
    ? {
        fullName: ownerProfile.full_name,
        avatarUrl: ownerProfile.avatar_url,
        bio: ownerProfile.bio,
        specialties: ownerProfile.specialties ?? [],
        languagesSpoken: ownerProfile.languages_spoken ?? [],
        websiteUrl: ownerProfile.website_url,
        facebookUrl: ownerProfile.facebook_url,
        instagramUrl: ownerProfile.instagram_url,
        linkedinUrl: ownerProfile.linkedin_url,
        statsTotalSales: ownerProfile.stats_total_sales ?? 0,
        statsSales12mo: ownerProfile.stats_sales_12mo ?? 0,
        statsPriceMinCents: ownerProfile.stats_price_min_cents,
        statsPriceMaxCents: ownerProfile.stats_price_max_cents,
        statsAvgPriceCents: ownerProfile.stats_avg_price_cents,
      }
    : null;

  // Active listings + sold listings — fetched separately so the page
  // renders two distinct sections (For Sale / Sold) without filtering
  // a single result set client-side.
  const { data: listingsRows, error: listingsErr } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, featured_until, published_at, latitude, longitude',
    )
    .eq('org_id', orgRow.id)
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .order('featured_until', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false, nullsFirst: false })
    .range(0, limit);

  if (listingsErr) {
    console.error('[fetchAgentProfile] listings query failed', listingsErr);
    return { org, agent, listings: [], soldListings: [], totalShown: 0, hasMore: false };
  }

  // Sold listings — separate query so the for-sale set keeps its own
  // featured_until / published_at ordering.
  const { data: soldRows } = await supabase
    .from('properties')
    .select(
      'id, short_id, slug_en, slug_es, title_en, title_es, transaction_type, property_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, neighborhood, city, country_code, image_count, latitude, longitude, sold_date, sold_price_cents, represented_side',
    )
    .eq('org_id', orgRow.id)
    .in('status', ['sold', 'rented'])
    .order('sold_date', { ascending: false, nullsFirst: false })
    .limit(50);

  const rows = (listingsRows ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') && !r.slug_es?.startsWith('aho-fixture-'),
  );
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;

  const ids = sliced.map((r) => r.id as string);
  const imageMap = await fetchPrimaryImageMap(supabase, ids);

  const listings: SearchListing[] = sliced.map((r) => ({
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
    primaryImageId: imageMap.get(r.id)?.cfImageId ?? null,
    primaryR2Key: imageMap.get(r.id)?.r2Key ?? null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
  }));

  // Sold listings — same shape + sold-side fields. Separate image map
  // (different ids than the for-sale set).
  const soldFiltered = (soldRows ?? []).filter(
    (r) =>
      !r.slug_en?.startsWith('aho-fixture-') && !r.slug_es?.startsWith('aho-fixture-'),
  );
  const soldImageMap = await fetchPrimaryImageMap(
    supabase,
    soldFiltered.map((r) => r.id as string),
  );
  const soldListings: SoldListing[] = soldFiltered.map((r) => ({
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
    primaryImageId: soldImageMap.get(r.id)?.cfImageId ?? null,
    primaryR2Key: soldImageMap.get(r.id)?.r2Key ?? null,
    latitude: r.latitude != null ? Number(r.latitude) : null,
    longitude: r.longitude != null ? Number(r.longitude) : null,
    soldDate: r.sold_date as string | null,
    soldPriceCents: r.sold_price_cents != null ? Number(r.sold_price_cents) : null,
    representedSide: (r.represented_side as 'buyer' | 'seller' | 'both' | null) ?? null,
  }));

  return { org, agent, listings, soldListings, totalShown: listings.length, hasMore };
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
  if (filters.country) params.set('country', filters.country);
  if (filters.transaction) params.set('transaction', filters.transaction);
  if (filters.minPrice != null) params.set('min_price', String(filters.minPrice));
  if (filters.maxPrice != null) params.set('max_price', String(filters.maxPrice));
  if (filters.bedsMin != null) params.set('beds_min', String(filters.bedsMin));
  if (filters.page && filters.page > 1) params.set('page', String(filters.page));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}
