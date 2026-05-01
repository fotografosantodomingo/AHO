import 'server-only';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const SHORT_ID_LENGTH = 6;
const SHORT_ID_PATTERN = /^[0-9a-zA-Z]{6}$/;

export interface PropertyDetail {
  id: string;
  shortId: string;
  status: string;
  publishedAt: string | null;
  titleEn: string | null;
  titleEs: string | null;
  descriptionEn: string | null;
  descriptionEs: string | null;
  slugEn: string | null;
  slugEs: string | null;
  transactionType: 'sale' | 'rent' | 'short_term';
  propertyType: string;
  priceCents: number;
  currency: string;
  pricePeriod: 'total' | 'monthly' | 'weekly' | 'nightly' | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  addressLine: string | null;
  neighborhood: string | null;
  city: string;
  stateRegion: string | null;
  countryCode: string;
  postalCode: string | null;
  displayAddress: boolean;
  orgId: string;
  createdAt: string;
  updatedAt: string;
  images: Array<{
    id: string;
    cfImageId: string | null;
    r2Key: string;
    altTextEn: string | null;
    altTextEs: string | null;
    width: number | null;
    height: number | null;
    position: number;
    isPrimary: boolean;
  }>;
}

/**
 * Parse the `[slug]` URL parameter into the slug part and the trailing
 * 6-char short ID. Returns `null` for malformed input.
 *
 * Format: `{slug-words}-{shortId}` — e.g. `luxury-villa-santo-domingo-3xk9wz`
 */
export function parseSlugParam(slug: string): { slugPart: string; shortId: string } | null {
  if (slug.length < SHORT_ID_LENGTH + 2) return null;
  const shortId = slug.slice(-SHORT_ID_LENGTH);
  const sep = slug.charAt(slug.length - SHORT_ID_LENGTH - 1);
  if (sep !== '-') return null;
  if (!SHORT_ID_PATTERN.test(shortId)) return null;
  const slugPart = slug.slice(0, -SHORT_ID_LENGTH - 1);
  if (slugPart.length === 0) return null;
  return { slugPart, shortId };
}

export interface ListingContact {
  agentFullName: string | null;
  agentPhone: string | null;
  agentWhatsappPhone: string | null;
  agentAvatarUrl: string | null;
  agentBio: string | null;
  agentWebsiteUrl: string | null;
  agentFacebookUrl: string | null;
  agentInstagramUrl: string | null;
  agentLinkedinUrl: string | null;
  agentSpecialties: string[];
  agentLanguagesSpoken: string[];
  orgId: string;
  orgName: string;
}

/**
 * Look up the public-safe contact info for a listing's agent. Calls the
 * `get_listing_contact` SECURITY DEFINER function from `0009_leads.sql`,
 * which:
 *   - Returns null on listings that are not active+published
 *   - Exposes only the agent's `full_name` + `phone` and the org's name
 *     (no email, no other profile fields)
 *
 * Used by the public detail page to render the WhatsApp button.
 */
export async function fetchListingContact(
  propertyId: string,
): Promise<ListingContact | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('get_listing_contact', {
    p_property_id: propertyId,
  });
  if (error) {
    console.error('[fetchListingContact]', error);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    agentFullName: row.agent_full_name ?? null,
    agentPhone: row.agent_phone ?? null,
    agentWhatsappPhone: row.agent_whatsapp_phone ?? null,
    agentAvatarUrl: row.agent_avatar_url ?? null,
    agentBio: row.agent_bio ?? null,
    agentWebsiteUrl: row.agent_website_url ?? null,
    agentFacebookUrl: row.agent_facebook_url ?? null,
    agentInstagramUrl: row.agent_instagram_url ?? null,
    agentLinkedinUrl: row.agent_linkedin_url ?? null,
    agentSpecialties: (row.agent_specialties as string[] | null) ?? [],
    agentLanguagesSpoken: (row.agent_languages_spoken as string[] | null) ?? [],
    orgId: row.org_id,
    orgName: row.org_name,
  };
}

/**
 * Fetch a property by its short ID. RLS does the filtering — anonymous
 * callers see only `status='active' AND published_at IS NOT NULL`; org
 * members see all of their org's listings.
 *
 * Images are joined by the embedded resource syntax — only `upload_status =
 * 'confirmed'` images are exposed to anonymous via RLS, so anon callers
 * automatically get the public-safe set.
 */
export async function fetchPropertyByShortId(
  shortId: string,
): Promise<PropertyDetail | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('properties')
    .select(
      `
        id, short_id, status, published_at,
        title_en, title_es, description_en, description_es,
        slug_en, slug_es,
        transaction_type, property_type,
        price_cents, currency, price_period,
        bedrooms, bathrooms, area_sqm,
        address_line, neighborhood, city, state_region, country_code, postal_code, display_address,
        org_id, created_at, updated_at,
        property_images (
          id, r2_key, cf_image_id,
          alt_text_en, alt_text_es,
          width, height, position, is_primary, upload_status
        )
      `,
    )
    .eq('short_id', shortId)
    .maybeSingle();

  if (error) {
    console.error('[fetchPropertyByShortId]', error);
    return null;
  }
  if (!data) return null;

  // Camel-case the response (Supabase JS returns snake_case from PostgREST).
  return {
    id: data.id,
    shortId: data.short_id,
    status: data.status,
    publishedAt: data.published_at,
    titleEn: data.title_en,
    titleEs: data.title_es,
    descriptionEn: data.description_en,
    descriptionEs: data.description_es,
    slugEn: data.slug_en,
    slugEs: data.slug_es,
    transactionType: data.transaction_type,
    propertyType: data.property_type,
    priceCents: Number(data.price_cents),
    currency: data.currency,
    pricePeriod: data.price_period,
    bedrooms: data.bedrooms,
    bathrooms: data.bathrooms != null ? Number(data.bathrooms) : null,
    areaSqm: data.area_sqm != null ? Number(data.area_sqm) : null,
    addressLine: data.address_line,
    neighborhood: data.neighborhood,
    city: data.city,
    stateRegion: data.state_region,
    countryCode: data.country_code,
    postalCode: data.postal_code,
    displayAddress: data.display_address,
    orgId: data.org_id,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    images: (data.property_images ?? [])
      // Only show confirmed images on the public detail page. Pending /
      // uploading rows are intermediate states and shouldn't render.
      .filter((img) => img.upload_status === 'confirmed')
      .map((img) => ({
        id: img.id,
        r2Key: img.r2_key,
        cfImageId: img.cf_image_id,
        altTextEn: img.alt_text_en,
        altTextEs: img.alt_text_es,
        width: img.width,
        height: img.height,
        position: img.position,
        isPrimary: img.is_primary,
      }))
      .sort((a, b) => a.position - b.position),
  };
}
