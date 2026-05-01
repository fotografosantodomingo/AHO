import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { CreateListingSchema } from '@/lib/listings/listing-schema';
import { slugifyListing } from '@/lib/listings/slug';

export const runtime = 'edge';

/**
 * POST /api/listings
 *
 * Create a draft listing. Replaces the previous Server Action path
 * (`createListing` in `src/lib/listings/actions.ts`). Server Actions on
 * `@cloudflare/next-on-pages` had reliability issues — Origin / Host
 * detection mismatches behind the Pages CDN caused 404 + "An unexpected
 * response was received from the server" RSC errors. API routes are
 * first-class on next-on-pages and don't have those quirks.
 *
 * Auth: signed-in user (cookie session). RLS enforces org membership +
 * listing cap on the INSERT.
 *
 * Body: see `CreateListingSchema` in `lib/listings/listing-schema.ts`.
 *
 * Response shape:
 *   - 201 { ok: true, id }                        — created
 *   - 400 { ok: false, errorCode, fieldErrors? } — invalid input
 *   - 401 { ok: false, errorCode: 'unauthenticated' }
 *   - 403 { ok: false, errorCode: 'no_org' | 'forbidden_or_at_cap' }
 *   - 500 { ok: false, errorCode: <db message> } — unexpected DB error
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_json' },
      { status: 400 },
    );
  }

  const parsed = CreateListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'invalid_input',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;

  const { data: memberships } = await supabase
    .from('organization_members')
    .select('org_id, role')
    .eq('user_id', userId)
    .in('role', ['owner', 'manager', 'agent']);
  if (!memberships || memberships.length === 0) {
    return NextResponse.json(
      { ok: false, errorCode: 'no_org' },
      { status: 403 },
    );
  }
  const orgId = memberships[0]!.org_id;

  const titleForSlug = (data.title_en || data.title_es)!;
  const slugBase = slugifyListing(titleForSlug, data.city, data.country_code);

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
      location:
        data.latitude != null && data.longitude != null
          ? `SRID=4326;POINT(${data.longitude} ${data.latitude})`
          : null,
      amenities: data.amenities ?? [],
    })
    .select('id')
    .single();

  if (insertErr) {
    if (insertErr.code === '42501') {
      return NextResponse.json(
        { ok: false, errorCode: 'forbidden_or_at_cap' },
        { status: 403 },
      );
    }
    console.error('[POST /api/listings] insert failed', insertErr);
    return NextResponse.json(
      { ok: false, errorCode: insertErr.message ?? 'db_error' },
      { status: 500 },
    );
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return NextResponse.json({ ok: true, id: created.id as string }, { status: 201 });
}

