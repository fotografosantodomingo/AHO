import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

const ContactSchema = z.object({
  email: z.string().email().max(320),
  full_name: z.string().max(200).optional().nullable(),
  country_code: z.string().max(64).optional().nullable(),
});

const BodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  contacts: z.array(ContactSchema).min(1).max(10_000),
});

/**
 * POST /api/admin/email/audiences — create a new audience + bulk-
 * import contacts from a parsed CSV (the Client Component parses
 * the file in the browser and posts JSON here).
 *
 * Admin-gated via the user-context client (RLS enforces
 * is_platform_admin on writes). The actual contact bulk-insert
 * uses the admin client so we can hit the 10k row ceiling without
 * paginating through user-context PostgREST.
 *
 * Dedup: ON CONFLICT (audience_id, email) DO NOTHING — uploading
 * a CSV with duplicate rows or re-uploading the same list just
 * skips duplicates instead of erroring.
 */
export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid_body', issues: e instanceof z.ZodError ? e.flatten() : 'unknown' },
      { status: 400 },
    );
  }

  // --- Auth: must be platform admin --------------------------------
  const userClient = await createServerSupabaseClient();
  const { data: userRes } = await userClient.auth.getUser();
  const user = userRes.user;
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data: profile } = await userClient
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();

  // --- Insert the audience row -------------------------------------
  const { data: audience, error: audErr } = await admin
    .from('email_audiences')
    .insert({
      name: body.name,
      description: body.description ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (audErr || !audience) {
    console.error('[POST /api/admin/email/audiences] audience insert failed', audErr);
    return NextResponse.json(
      { error: 'audience_insert_failed' },
      { status: 500 },
    );
  }

  // --- Normalize + dedup contacts in-memory before insert ----------
  const seen = new Set<string>();
  const rows = body.contacts
    .map((c) => ({
      audience_id: audience.id,
      email: c.email.toLowerCase().trim(),
      full_name: c.full_name?.trim() || null,
      country_code: c.country_code?.toUpperCase().trim() || null,
    }))
    .filter((c) => {
      if (seen.has(c.email)) return false;
      seen.add(c.email);
      return true;
    });

  // --- Bulk-insert in chunks of 1000 -------------------------------
  let inserted = 0;
  const CHUNK = 1000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error: insErr, count } = await admin
      .from('email_audience_contacts')
      .upsert(slice, {
        onConflict: 'audience_id,email',
        ignoreDuplicates: true,
        count: 'exact',
      });
    if (insErr) {
      console.error('[POST /api/admin/email/audiences] contacts insert failed', insErr);
      return NextResponse.json(
        {
          error: 'contacts_insert_failed',
          partial: { audienceId: audience.id, inserted },
        },
        { status: 500 },
      );
    }
    inserted += count ?? slice.length;
  }

  // --- Update audience contact_count -------------------------------
  await admin
    .from('email_audiences')
    .update({ contact_count: inserted })
    .eq('id', audience.id);

  return NextResponse.json({
    ok: true,
    audienceId: audience.id,
    inserted,
    duplicatesSkipped: body.contacts.length - rows.length,
  });
}
