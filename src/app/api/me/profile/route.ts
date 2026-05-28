import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePublicSlugForOrg } from '@/lib/agents/public-slug';

export const runtime = 'edge';

/**
 * PUT /api/me/profile
 *
 * Update the signed-in user's own profile row. RLS policy
 * `profiles_self_update` (from migration 0002) gates the UPDATE; this
 * route is just convenience over a direct supabase call from the client
 * so we centralize validation + the protected-fields filter (is_admin,
 * admin_role, email — none of these are accepted from this endpoint).
 *
 * The `protect_profile_admin_fields` BEFORE-UPDATE trigger from 0002
 * also strips `is_admin` / `admin_role` mutations on user-context
 * updates as defense in depth.
 *
 * All fields are optional. Only provided keys are written; null clears.
 */

const ProfileUpdateSchema = z.object({
  full_name: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  whatsapp_phone: z.string().trim().max(40).optional().nullable(),
  avatar_url: z.string().trim().url().max(500).optional().nullable(),
  bio: z.string().trim().max(2000).optional().nullable(),
  website_url: z.string().trim().url().max(500).optional().nullable(),
  facebook_url: z.string().trim().url().max(500).optional().nullable(),
  instagram_url: z.string().trim().url().max(500).optional().nullable(),
  linkedin_url: z.string().trim().url().max(500).optional().nullable(),
  specialties: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  languages_spoken: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  city: z.string().trim().max(120).optional().nullable(),
  country_code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .optional()
    .nullable(),
  // 7 locales since 2026-05-28 — was en/es only at launch. The agent's
  // main social-publish language; platform listings stay multilingual
  // (translated for buyer-side SEO reach) but each social post fires in
  // exactly this language. DB CHECK constraint matches via 0081.
  preferred_language: z.enum(['en', 'es', 'pl', 'pt', 'de', 'fr', 'it']).optional(),
  preferred_currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  marketing_opt_in: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }

  const parsed = ProfileUpdateSchema.safeParse(body);
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

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }

  // Strip the explicitly-protected fields server-side too. The trigger
  // would also reset them, but failing fast is friendlier.
  const data = parsed.data;
  const updateRow: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) updateRow[k] = v;
  }
  // Empty arrays from the form should still be persisted (clears tags).
  if (Array.isArray(data.specialties)) updateRow.specialties = data.specialties;
  if (Array.isArray(data.languages_spoken))
    updateRow.languages_spoken = data.languages_spoken;

  if (Object.keys(updateRow).length === 0) {
    return NextResponse.json({ ok: true, id: userResult.user.id });
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update(updateRow)
    .eq('id', userResult.user.id);

  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[PUT /api/me/profile] update failed', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }

  // After a successful profile update, recompute the SEO `public_slug`
  // on the user's owned org (if any). The slug is a function of
  // (full_name, city, country_code); whenever any of those change we
  // refresh it. Service-role client because the resolver scans the
  // global public_slug space for collisions, which RLS would limit to
  // orgs with public listings — pre-launch orgs would be invisible and
  // we'd miss legitimate collisions.
  if (
    updateRow.full_name !== undefined ||
    updateRow.city !== undefined ||
    updateRow.country_code !== undefined
  ) {
    try {
      const admin = createAdminClient();
      const { data: ownedOrg } = await admin
        .from('organization_members')
        .select('org_id')
        .eq('user_id', userResult.user.id)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      const orgId = ownedOrg?.org_id as string | undefined;
      if (orgId) {
        const { data: profile } = await admin
          .from('profiles')
          .select('full_name, city, country_code')
          .eq('id', userResult.user.id)
          .maybeSingle();
        const newSlug = await resolvePublicSlugForOrg(
          admin,
          orgId,
          profile?.full_name ?? null,
          profile?.city ?? null,
          profile?.country_code ?? null,
        );
        // Always write — null clears stale slug if profile became sparse.
        await admin
          .from('organizations')
          .update({ public_slug: newSlug })
          .eq('id', orgId);
      }
    } catch (e) {
      // Slug is best-effort: we don't fail the whole profile-save if the
      // slug recompute hits a transient issue. The next save will retry.
      console.warn('[PUT /api/me/profile] public_slug recompute skipped', e);
    }
  }

  return NextResponse.json({ ok: true, id: userResult.user.id });
}
