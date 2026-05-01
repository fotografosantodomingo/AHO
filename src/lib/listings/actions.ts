'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
// Schema lives in a sibling non-server module so the client form can
// import it for `zodResolver(...)`. Next.js 15 only allows async-function
// exports from `'use server'` files — non-function exports (Zod schemas,
// types, constants) become undefined on the client and crash the
// resolver. We import the schema here for server-side validation; the
// form imports the same schema directly from `./listing-schema`.
import { CreateListingSchema } from './listing-schema';

/**
 * Server actions for the listing form. Both `createListing` and `updateListing`
 * run as the signed-in user via the user-context Supabase client — RLS
 * enforces:
 *   - INSERT: org-member role agent/manager/owner + cap function check
 *   - UPDATE: org-member role agent/manager/owner; trigger handles transitions
 *
 * The inputs are Zod-validated so the route handler / form submission gets a
 * 400 with field-level errors before the DB sees the request.
 */

interface ActionResult {
  ok: boolean;
  /** Property UUID on create-success or update-success. */
  id?: string;
  /** When `ok=false`, a code consumable by the i18n error map. */
  errorCode?: string;
  /** Optional zod field errors. */
  fieldErrors?: Record<string, string[]>;
}

function buildLocationEwkt(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

/**
 * Slug helper — keep in sync with the listing slug rules in HANDOFF §8.3:
 * `{title-words}-{city}-{country}`, lowercase ASCII, hyphenated, capped at 60.
 */
function slugifyListing(title: string, city: string, country: string): string {
  const base = `${title} ${city} ${country}`
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'listing';
}

export async function createListing(input: unknown): Promise<ActionResult> {
  const parsed = CreateListingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: 'invalid_input',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return { ok: false, errorCode: 'unauthenticated' };
  }
  const userId = userResult.user.id;

  // Find the user's org. v1 assumes one org per user; if multiple, take the
  // first agent-or-higher role.
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .in('role', ['owner', 'manager', 'agent']);
  if (!memberships || memberships.length === 0) {
    return { ok: false, errorCode: 'no_org' };
  }
  const orgId = memberships[0]!.org_id;

  // Slug source: prefer EN title, fall back to ES.
  const titleForSlug = (data.title_en || data.title_es)!;
  const slugBase = slugifyListing(titleForSlug, data.city, data.country_code);

  // Insert as draft. Slugs are populated when title is set; empty stays null.
  const { data: created, error: insertErr } = await supabase
    .from('properties')
    .insert({
      org_id: orgId,
      created_by: userId,
      transaction_type: data.transaction_type,
      property_type: data.property_type,
      status: 'draft',
      title_en: data.title_en || null,
      title_es: data.title_es || null,
      description_en: data.description_en || null,
      description_es: data.description_es || null,
      slug_en: data.title_en ? slugBase : null,
      slug_es: data.title_es ? slugBase : null,
      price_cents: data.price_cents,
      currency: data.currency,
      price_period: data.price_period || null,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      area_sqm: data.area_sqm ?? null,
      address_line: data.address_line || null,
      neighborhood: data.neighborhood || null,
      city: data.city,
      state_region: data.state_region || null,
      country_code: data.country_code,
      postal_code: data.postal_code || null,
      display_address: data.display_address,
      // Only build a geography point if both coords are provided. The
      // sync_property_latlng() trigger handles the latitude/longitude
      // denorm columns either way.
      location:
        data.latitude != null && data.longitude != null
          ? buildLocationEwkt(data.longitude, data.latitude)
          : null,
      amenities: data.amenities ?? [],
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '42501') {
      // RLS denied — most commonly the listing-cap was hit.
      return { ok: false, errorCode: 'forbidden_or_at_cap' };
    }
    return { ok: false, errorCode: insertErr.message };
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return { ok: true, id: created.id as string };
}

export async function publishListing(id: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, errorCode: 'invalid_id' };
  }
  const supabase = await createServerSupabaseClient();
  const { error: updateErr } = await supabase
    .from('properties')
    .update({
      status: 'active',
      published_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (updateErr) {
    if (updateErr.code === '42501' || updateErr.message?.includes('listing_cap_exceeded')) {
      return { ok: false, errorCode: 'listing_cap_exceeded' };
    }
    return { ok: false, errorCode: updateErr.message };
  }
  revalidatePath('/[locale]/dashboard/properties', 'page');
  return { ok: true, id };
}
