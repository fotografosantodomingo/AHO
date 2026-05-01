import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordPropertyView, ANON_COOKIE_NAME } from '@/lib/listings/recent-views';
import { recordPropertyEvent } from '@/lib/listings/events';
import type { Locale } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/properties/:id/view
 *
 * Body: `{ locale: 'en' | 'es', sourcePath?: string }`
 *
 * Records a "this visitor viewed this listing" row for the
 * recently-viewed rail (feat/recently-viewed, migration 0025).
 *
 * Identity:
 *   - Authenticated user → sets `user_id` from session.
 *   - Anonymous visitor  → reads / sets `aho_anon_id` cookie. The
 *     cookie is HTTP-only, SameSite=Lax, 1-year TTL. If absent on first
 *     view, this route generates a fresh UUID and Set-Cookie's it on
 *     the response. Subsequent views read the same cookie.
 *
 * Best-effort: errors are logged, never surfaced to the caller. The
 * client component fires this fire-and-forget on the property detail
 * page render; a tracking failure must not affect page UX.
 *
 * Validation: property ID must exist + be active+published. Drops
 * tracking calls for archived / draft / sold listings.
 */

const ParamSchema = z.object({ id: z.string().uuid() });
const BodySchema = z.object({
  locale: z.enum(['en', 'es']),
  sourcePath: z.string().max(500).optional(),
});

/**
 * Coarse-grained source classification from the referrer path. Maps a
 * URL like `/en/search?city=...` to the tag `'search'`. Used as the
 * short `source` column on property_events so dashboards can cut "which
 * surface drives the most views" without parsing full paths.
 *
 * Returns null when the path doesn't match any known surface (direct
 * visit, deep link, etc.). The full path is still stored in metadata.
 */
function deriveSourceTag(path: string | null): string | null {
  if (!path) return null;
  // Strip locale prefix.
  const m = path.match(/^\/(en|es)(\/.*)?$/);
  const rest = m ? (m[2] ?? '/') : path;
  if (rest.startsWith('/search') || rest.startsWith('/buscar')) return 'search';
  if (rest.startsWith('/properties-in') || rest.startsWith('/inmuebles-en')) return 'city';
  if (rest.startsWith('/agents/') || rest.startsWith('/agentes/')) return 'agent';
  if (rest.startsWith('/countries') || rest.startsWith('/paises')) return 'countries';
  if (rest.startsWith('/saved-properties') || rest.startsWith('/inmuebles-guardados'))
    return 'saved';
  if (rest === '/' || rest === '') return 'home';
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const raw = await params;
  const parsed = ParamSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }
  const propertyId = parsed.data.id;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* ignore — body is optional shape; defaults to en */
  }
  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_body' }, { status: 400 });
  }
  const { locale, sourcePath } = parsedBody.data;

  // Resolve identity. Use the user-context client to get auth state;
  // do the actual write via admin so anon writes work.
  const userClient = await createServerSupabaseClient();
  const { data: userResult } = await userClient.auth.getUser();
  const userId = userResult.user?.id ?? null;

  // Anon cookie. NextRequest.cookies is read-only here for outbound
  // headers, so we set via the response object below.
  let anonymousId: string | null = req.cookies.get(ANON_COOKIE_NAME)?.value ?? null;
  let setCookie = false;
  if (!userId && !anonymousId) {
    anonymousId = crypto.randomUUID();
    setCookie = true;
  }

  // Verify the property is publicly visible. Quick existence + status
  // check; doesn't block the response on lookup failure. Also pulls
  // org_id so we can denormalize it onto the property_events row
  // (saves a re-lookup in recordPropertyEvent).
  const { data: prop, error: propErr } = await userClient
    .from('properties')
    .select('id, status, published_at, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (propErr) {
    console.warn('[view] property lookup', propErr);
  }
  if (!prop || prop.status !== 'active' || !prop.published_at) {
    // Don't track invisible listings; respond ok to keep the client happy.
    const res = NextResponse.json({ ok: true, tracked: false });
    if (setCookie && anonymousId) {
      res.cookies.set({
        name: ANON_COOKIE_NAME,
        value: anonymousId,
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 60 * 60 * 24 * 365, // 1 year
      });
    }
    return res;
  }

  // Record the view. Admin client so anon writes work (no RLS INSERT
  // policy by design — server is the trust boundary).
  // Two writes happen: (a) the per-visitor recent-view UPSERT for the
  // "Recently viewed" rail, (b) the append-only analytics event for
  // the agent dashboard. Both best-effort; failures logged not thrown.
  const admin = createAdminClient();
  await recordPropertyView({
    supabase: admin,
    propertyId,
    userId,
    anonymousId,
    locale: locale as Locale,
    sourcePath: sourcePath ?? null,
  });
  await recordPropertyEvent({
    supabase: admin,
    propertyId,
    orgId: prop.org_id as string,
    eventType: 'property_view',
    userId,
    anonymousId,
    source: deriveSourceTag(sourcePath ?? null),
    metadata: sourcePath ? { source_path: sourcePath } : {},
  });

  const res = NextResponse.json({ ok: true, tracked: true });
  if (setCookie && anonymousId) {
    res.cookies.set({
      name: ANON_COOKIE_NAME,
      value: anonymousId,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}
