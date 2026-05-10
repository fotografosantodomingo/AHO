import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * Failures sub-resource for the photo-import flow.
 *
 *   GET  /api/properties/:id/import-photos/failures
 *     Lists unresolved dead-letter rows for the listing. Returns
 *     `{ failures: [{ id, source_url, error_code, attempts,
 *     first_failed_at, last_failed_at }] }` ordered by `last_failed_at`
 *     desc — most recent failure first. Org-member authz is enforced
 *     by RLS on the `photo_import_failures` table.
 *
 *   POST /api/properties/:id/import-photos/failures
 *     `{ action: 'dismiss', source_url }` — mark a failure resolved
 *     without retrying. Used by the Dismiss button in the failures UI.
 *     Retry is handled by re-POSTing to the parent route with the
 *     single URL; success there auto-resolves via the SQL helper.
 *
 * Both endpoints run in the user's session (RLS-scoped Supabase client),
 * so a non-member of the listing's org sees nothing and can mutate
 * nothing. No service-role escalation.
 */

const ParamSchema = z.object({ id: z.string().uuid() });

const PostBodySchema = z.object({
  action: z.literal('dismiss'),
  source_url: z.string().url(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Validate the path param up front: passing a non-uuid straight into
  // PostgREST's `.eq('property_id', …)` makes Postgres raise 22P02 and
  // we'd return 500 instead of a clean 400. Sibling /favorite/route.ts
  // already does this — bring this endpoint in line.
  // (QA-2026-05-10 P0 #3.)
  const raw = await params;
  const parsed = ParamSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const propertyId = parsed.data.id;

  const supabase = await createServerSupabaseClient();
  const { data: user, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // RLS gates this — non-org-members get an empty list back, not 403.
  // That's fine: 403 would leak listing existence; an empty list mirrors
  // every other org-scoped query in the app.
  const { data, error } = await supabase
    .from('photo_import_failures')
    .select('id, source_url, error_code, attempts, first_failed_at, last_failed_at')
    .eq('property_id', propertyId)
    .is('resolved_at', null)
    .order('last_failed_at', { ascending: false })
    .limit(50);

  if (error) {
    console.warn(
      `[import-photos/failures] list failed for ${propertyId}: ${error.message}`,
    );
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }

  return NextResponse.json({ failures: data ?? [] });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Same uuid validation as GET — without it the RPC would propagate
  // a Postgres 22P02 as a 500.
  const rawParams = await params;
  const parsedParams = ParamSchema.safeParse(rawParams);
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
  }
  const propertyId = parsedParams.data.id;

  const body = await req.json().catch(() => null);
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: user, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // RPC call — the SECURITY INVOKER function runs under RLS, so a
  // non-member of the listing's org can't actually mutate anything
  // even if they guess a URL.
  const { error } = await supabase.rpc('resolve_photo_import_failure', {
    p_property_id: propertyId,
    p_source_url: parsed.data.source_url,
  });
  if (error) {
    console.warn(
      `[import-photos/failures] dismiss failed for ${propertyId}: ${error.message}`,
    );
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
