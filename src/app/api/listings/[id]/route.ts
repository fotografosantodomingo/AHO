import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { TRANSACTION_TYPES, PRICE_PERIODS } from '@/db/schema';
import { slugifyListing } from '@/lib/listings/slug';

export const runtime = 'edge';

/**
 * PATCH + DELETE /api/listings/:id
 *
 * PATCH — agent edits a published or draft listing. Worldwide-shaped:
 *   editable          → price + currency + period + bd/ba/area + lot +
 *                       year built + neighborhood + address + amenities +
 *                       features (Facts & Features jsonb) + titles +
 *                       descriptions + SEO fields + city + state + country
 *   NOT editable here → status (use mark-sold / archive / publish routes),
 *                       short_id, slug_en/slug_es (URL-stable), location/
 *                       lat/lng (location pipeline), sold_* fields, primary_
 *                       agent_id (multi-agent v1.1 surface), org_id,
 *                       created_by.
 *
 * Slugs are intentionally locked at publish: changing them breaks SEO
 * authority. Title changes do NOT auto-regenerate an existing slug. The
 * one exception is locale-fill: if a listing has slug_en but slug_es is
 * null, and the agent adds title_es on PATCH, we generate the missing
 * slug_es so the listing has a Spanish URL. Existing non-null slugs are
 * never overwritten. If an agent needs a different URL they delete +
 * re-create.
 *
 * Price-change audit: when `price_cents` differs from the prior value,
 * we write a `listing.price_changed` audit_log row. The 0014 anon-read
 * policy makes this row visible to the price-history block on
 * /properties/:slug. Payload contract (DECISIONS 2026-05-01 audit-log):
 * `{ from_cents, to_cents, currency, changed_at }` — public-safe lifecycle
 * facts only, no closing_notes / no prior_status.
 *
 * RLS gates the UPDATE: org members agent / manager / owner can edit
 * their own org's listings; admins can edit anything. Non-owners get
 * 0 rows back from the .select() and we return 404.
 *
 * DELETE — same shape as before; org delete gated by RLS, R2 objects
 * orphan for the periodic sweep (out of scope for this batch).
 */

const FeaturesValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.null(),
]);

const PatchSchema = z
  .object({
    title_en: z.string().trim().max(120).nullable().optional(),
    title_es: z.string().trim().max(120).nullable().optional(),
    description_en: z.string().trim().max(20000).nullable().optional(),
    description_es: z.string().trim().max(20000).nullable().optional(),
    transaction_type: z.enum(TRANSACTION_TYPES).optional(),
    property_type: z.string().trim().min(1).max(40).optional(),
    price_cents: z.number().int().nonnegative().max(9_999_999_999_999).optional(),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
    price_period: z.enum(PRICE_PERIODS).nullable().optional(),
    bedrooms: z.number().int().min(0).max(99).nullable().optional(),
    bathrooms: z.number().min(0).max(99).nullable().optional(),
    area_sqm: z.number().min(0).max(1_000_000).nullable().optional(),
    lot_size_sqm: z.number().min(0).max(10_000_000).nullable().optional(),
    year_built: z.number().int().min(1500).max(2100).nullable().optional(),
    address_line: z.string().trim().max(200).nullable().optional(),
    neighborhood: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().min(1).max(120).optional(),
    state_region: z.string().trim().max(120).nullable().optional(),
    country_code: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
    postal_code: z.string().trim().max(20).nullable().optional(),
    display_address: z.boolean().optional(),
    amenities: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
    features: z.record(z.string(), FeaturesValueSchema).optional(),
    seo_title_en: z.string().trim().max(140).nullable().optional(),
    seo_title_es: z.string().trim().max(140).nullable().optional(),
    seo_description_en: z.string().trim().max(280).nullable().optional(),
    seo_description_es: z.string().trim().max(280).nullable().optional(),
  })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
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
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: false, errorCode: 'no_fields' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }
  const actorId = userResult.user.id;

  // Read prior price + slugs + city/country for the audit row + slug fill.
  // If RLS denies the SELECT, we'd get null here — treat as not_found. The
  // subsequent UPDATE has its own RLS check.
  const { data: prior } = await supabase
    .from('properties')
    .select('id, price_cents, currency, slug_en, slug_es, city, country_code')
    .eq('id', id)
    .maybeSingle();
  if (!prior) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  // Locale slug fill: when an agent adds a title in a previously-empty
  // locale (e.g. EN-only listing later gets a Spanish title), generate
  // the missing slug so `/es/propiedades/...` resolves. We do NOT
  // regenerate existing non-null slugs — those are URL-stable per the
  // SEO rule (changing a published slug breaks back-links). City /
  // country in the update body take precedence; otherwise we use the
  // current row's values.
  const updatePayload: Record<string, unknown> = { ...data };
  const effectiveCity = (data.city ?? (prior.city as string)) || '';
  const effectiveCountry =
    (data.country_code ?? (prior.country_code as string)) || '';
  if (
    data.title_en &&
    !prior.slug_en &&
    effectiveCity &&
    effectiveCountry
  ) {
    updatePayload.slug_en = slugifyListing(
      data.title_en,
      effectiveCity,
      effectiveCountry,
    );
  }
  if (
    data.title_es &&
    !prior.slug_es &&
    effectiveCity &&
    effectiveCountry
  ) {
    updatePayload.slug_es = slugifyListing(
      data.title_es,
      effectiveCity,
      effectiveCountry,
    );
  }

  const { data: updated, error: updateErr } = await supabase
    .from('properties')
    .update(updatePayload)
    .eq('id', id)
    .select('id')
    .single();

  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[PATCH /api/listings/:id]', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  // Price-change audit. The audit_log row is publicly readable via 0014
  // for kind='listing.price_changed' on active+published properties; the
  // price-history block on /properties/:slug picks it up automatically.
  const priorCents = Number(prior.price_cents);
  if (
    data.price_cents !== undefined &&
    data.price_cents !== priorCents &&
    Number.isFinite(priorCents)
  ) {
    const { error: auditErr } = await supabase.from('audit_log').insert({
      kind: 'listing.price_changed',
      actor_id: actorId,
      target_id: id,
      payload: {
        from_cents: priorCents,
        to_cents: data.price_cents,
        currency: (data.currency as string | undefined) ?? prior.currency,
        changed_at: new Date().toISOString(),
      },
    });
    if (auditErr) {
      // Audit-write failure does NOT unwind the listing edit (the listing
      // IS edited; the audit row is a record-of-fact). Logged for ops.
      console.error('[PATCH /api/listings/:id] price-change audit failed', auditErr);
    }
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  revalidatePath('/[locale]/properties/[slug]', 'page');
  return NextResponse.json({ ok: true, id: updated.id });
}

/**
 * DELETE /api/listings/:id (unchanged from prior batch).
 * RLS gates the delete; any non-RLS error is reported as-is.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }

  const { data: deleted, error: delErr } = await supabase
    .from('properties')
    .delete()
    .eq('id', id)
    .select('id');

  if (delErr) {
    if (delErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[DELETE /api/listings/:id]', delErr);
    return NextResponse.json(
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }
  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return NextResponse.json({ ok: true, id });
}
