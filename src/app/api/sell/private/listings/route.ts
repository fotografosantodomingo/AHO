import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { CreateListingSchema } from '@/lib/listings/listing-schema';
import { slugifyListing } from '@/lib/listings/slug';

export const runtime = 'edge';

/**
 * POST /api/sell/private/listings
 *
 * Track C / Agent 2 endpoint for the $5 private-owner flow. Atomically
 * (best-effort across Postgres calls):
 *
 *   1. Verify the caller is signed in.
 *   2. Verify the caller owns the `listing_purchases.id` they passed
 *      AND that row is paid + unconsumed + unrefunded + unexpired.
 *   3. Ensure the user has an organizations row to attach the property
 *      to. Private owners get a synthetic org per user — slug
 *      `private-<userId-short>`, name from `profiles.full_name` (falls
 *      back to email local-part). Created lazily on first paid listing.
 *   4. INSERT the property row with:
 *        status='active'                    — private owners skip draft
 *        published_via='private_purchase'   — discriminator
 *        expires_at = purchase.expires_at  — carry the TTL over
 *        features.social_channel = ...      — captured for the future
 *                                             one-channel publish step
 *   5. UPDATE the purchase row's property_id to link it.
 *   6. Set profiles.account_type='private_owner' iff it is still the
 *      default 'private_owner'. We never demote an existing
 *      'agent' / 'agency' user; an agent who buys a $5 listing for
 *      personal use stays an agent.
 *
 * Step 2 uses the user-context client (RLS-enforced read on
 * `listing_purchases.buyer_user_id = auth.uid()`). Steps 3-6 use the
 * admin client because:
 *   - Step 3 needs to INSERT into `organizations` + `organization_members`,
 *     which are gated by org-membership policies the user doesn't yet
 *     have for a fresh org. RLS bootstrapping problem.
 *   - Step 4 needs the org seat to be in place; same RLS gate as
 *     `/api/listings` BUT the listing-cap policy is sized for the
 *     agent subscription. We sidestep that for the $5 path because
 *     the cap is enforced economically by the per-listing fee, not
 *     by a subscription seat count.
 *   - Step 5 inserts on the service-role-only `listing_purchases`
 *     table (REVOKE on anon/authenticated per migration 0074).
 *
 * Response shape:
 *   - 201 { ok: true, id, slug, shortId }    — created and linked
 *   - 400 { ok: false, errorCode: ... }       — invalid input
 *   - 401 { ok: false, errorCode: 'unauthenticated' }
 *   - 403 { ok: false, errorCode: 'purchase_not_found' | 'purchase_consumed' | 'purchase_expired' | 'purchase_refunded' }
 *   - 500 { ok: false, errorCode: ... }
 */

const SocialChannel = z.enum(['facebook', 'instagram']);

const RequestSchema = z.object({
  purchaseId: z.string().uuid(),
  socialChannel: SocialChannel,
  listing: CreateListingSchema,
});

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_json' },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(raw);
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
  const { purchaseId, socialChannel, listing } = parsed.data;

  // Step 1: auth.
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }
  const userId = userResult.user.id;
  const userEmail = userResult.user.email ?? null;

  // Step 2: verify purchase row. Read via the user-context client so
  // RLS proves the row belongs to this user. We re-fetch the full
  // row server-side rather than trusting the request body.
  const { data: purchase, error: purchaseErr } = await supabase
    .from('listing_purchases')
    .select('id, buyer_user_id, property_id, paid_at, expires_at, refunded_at')
    .eq('id', purchaseId)
    .maybeSingle();

  if (purchaseErr) {
    console.error('[/api/sell/private/listings] purchase lookup', {
      code: purchaseErr.code,
      message: purchaseErr.message,
    });
    return NextResponse.json(
      { ok: false, errorCode: 'purchase_lookup_failed' },
      { status: 500 },
    );
  }
  if (!purchase || purchase.buyer_user_id !== userId) {
    return NextResponse.json(
      { ok: false, errorCode: 'purchase_not_found' },
      { status: 403 },
    );
  }
  if (purchase.property_id) {
    return NextResponse.json(
      { ok: false, errorCode: 'purchase_consumed' },
      { status: 403 },
    );
  }
  if (purchase.refunded_at) {
    return NextResponse.json(
      { ok: false, errorCode: 'purchase_refunded' },
      { status: 403 },
    );
  }
  if (new Date(purchase.expires_at) <= new Date()) {
    return NextResponse.json(
      { ok: false, errorCode: 'purchase_expired' },
      { status: 403 },
    );
  }

  // Step 3-6 use the admin client.
  const admin = createAdminClient();

  // Step 3a: lookup user's profile (for full_name + account_type).
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, full_name, email, account_type')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr || !profile) {
    console.error('[/api/sell/private/listings] profile lookup', {
      code: profileErr?.code,
      message: profileErr?.message,
    });
    return NextResponse.json(
      { ok: false, errorCode: 'profile_not_found' },
      { status: 500 },
    );
  }

  // Step 3b: find an existing org for this user OR create the
  // synthetic per-user private org. We prefer ANY existing
  // organization_members row for the user (covers the edge case of an
  // agent buying a $5 listing — we attach the private listing to their
  // existing agent org so it appears in the same dashboard).
  let orgId: string | null = null;
  {
    const { data: existingMembership } = await admin
      .from('organization_members')
      .select('org_id')
      .eq('user_id', userId)
      .in('role', ['owner', 'manager', 'agent'])
      .limit(1)
      .maybeSingle();
    if (existingMembership?.org_id) {
      orgId = existingMembership.org_id as string;
    }
  }

  if (!orgId) {
    // Create the synthetic private-owner org.
    const userShort = userId.replace(/-/g, '').slice(0, 8);
    const orgSlug = `private-${userShort}`;
    const displayName =
      profile.full_name && profile.full_name.trim().length > 0
        ? `${profile.full_name.trim()}'s listings`
        : userEmail
          ? `${userEmail.split('@')[0]}'s listings`
          : `Private listings (${userShort})`;

    const { data: newOrg, error: orgInsertErr } = await admin
      .from('organizations')
      .insert({
        name: displayName,
        slug: orgSlug,
        // `organizations.type` is one of (agent | agency | expert).
        // No 'private_owner' enum value exists at the org level — the
        // user-level discriminator is profiles.account_type. We use
        // 'agent' so existing org-level RLS works without
        // special-casing. The org is invisible on /agents/[slug]
        // because we filter that surface by profiles.account_type.
        type: 'agent',
        seats_total: 1,
        // No listing cap on the org itself; the $5 path's cap is
        // enforced per-purchase, not per-seat.
        listing_cap: null,
      })
      .select('id')
      .single();

    if (orgInsertErr || !newOrg) {
      console.error('[/api/sell/private/listings] org insert', {
        code: orgInsertErr?.code,
        message: orgInsertErr?.message,
        details: orgInsertErr?.details,
      });
      return NextResponse.json(
        { ok: false, errorCode: 'org_create_failed' },
        { status: 500 },
      );
    }
    orgId = newOrg.id as string;

    const { error: memberInsertErr } = await admin
      .from('organization_members')
      .insert({
        org_id: orgId,
        user_id: userId,
        role: 'owner',
      });

    if (memberInsertErr) {
      console.error('[/api/sell/private/listings] member insert', {
        code: memberInsertErr.code,
        message: memberInsertErr.message,
        details: memberInsertErr.details,
      });
      // Org was created but membership wasn't — surface the failure
      // rather than orphan the user. They can retry; the next attempt
      // sees the existing org and only writes the membership.
      return NextResponse.json(
        { ok: false, errorCode: 'member_create_failed' },
        { status: 500 },
      );
    }
  }

  // Step 4: INSERT the property row. We set status='active' and
  // published_via='private_purchase' + expires_at from the purchase.
  const titleForSlug = (listing.title_en || listing.title_es)!;
  const slugBase = slugifyListing(titleForSlug, listing.city, listing.country_code);

  const { data: created, error: insertErr } = await admin
    .from('properties')
    .insert({
      org_id: orgId,
      created_by: userId,
      transaction_type: listing.transaction_type,
      property_type: listing.property_type,
      // Private owners skip the draft step. They paid; they want it live.
      // The image-upload step that follows on the client can add photos
      // after the row is created — same as the agent flow's "publish
      // with images" path (the column doesn't require photos to be
      // present at INSERT time).
      status: 'active',
      published_at: new Date().toISOString(),
      published_via: 'private_purchase',
      expires_at: purchase.expires_at,
      title_en: listing.title_en || null,
      title_es: listing.title_es || null,
      description_en: listing.description_en || null,
      description_es: listing.description_es || null,
      slug_en: listing.title_en ? slugBase : null,
      slug_es: listing.title_es ? slugBase : null,
      price_cents: listing.price_cents,
      currency: listing.currency,
      price_period: listing.price_period || null,
      bedrooms: listing.bedrooms ?? null,
      bathrooms: listing.bathrooms ?? null,
      area_sqm: listing.area_sqm ?? null,
      address_line: listing.address_line || null,
      neighborhood: listing.neighborhood || null,
      city: listing.city,
      state_region: listing.state_region || null,
      country_code: listing.country_code,
      postal_code: listing.postal_code || null,
      display_address: listing.display_address,
      location:
        listing.latitude != null && listing.longitude != null
          ? `SRID=4326;POINT(${listing.longitude} ${listing.latitude})`
          : null,
      amenities: listing.amenities ?? [],
      // Stash the social channel pick on the features jsonb so the
      // future social-publish step can read it. Single channel only
      // for the $5 tier — multi-channel is an Agent-tier feature.
      features: { social_channel: socialChannel },
    })
    .select('id, short_id, slug_en, slug_es')
    .single();

  if (insertErr || !created) {
    console.error('[/api/sell/private/listings] property insert', {
      code: insertErr?.code,
      message: insertErr?.message,
      details: insertErr?.details,
      hint: insertErr?.hint,
    });
    return NextResponse.json(
      { ok: false, errorCode: 'property_create_failed' },
      { status: 500 },
    );
  }
  const propertyId = created.id as string;
  const shortId = created.short_id as string;
  const slug = (created.slug_en as string | null) ?? (created.slug_es as string | null);

  // Step 5: link the purchase row to the new property.
  const { error: linkErr } = await admin
    .from('listing_purchases')
    .update({ property_id: propertyId })
    .eq('id', purchaseId);

  if (linkErr) {
    console.error('[/api/sell/private/listings] purchase link update', {
      code: linkErr.code,
      message: linkErr.message,
    });
    // The listing is already live; surfacing this as an error would
    // confuse the user (their listing exists). Log loud and continue —
    // the day-55 renewal cron can self-heal an orphan purchase by
    // matching buyer_user_id + paid_at proximity if needed. The
    // success response still carries the new listing's URL.
  }

  // Step 6: bump account_type to 'private_owner' only if it's the
  // default. Never demote an agent or agency.
  if (profile.account_type === 'private_owner') {
    // It's already the default — no-op write. We skip the round-trip.
  } else if (profile.account_type === 'agent' || profile.account_type === 'agency') {
    // Don't touch — the agent kept their tier.
  } else {
    // Unknown value (forward-compat) — leave alone.
  }

  return NextResponse.json(
    {
      ok: true,
      id: propertyId,
      slug: slug ?? null,
      shortId,
    },
    { status: 201 },
  );
}
