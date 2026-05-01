import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordPropertyEvent } from '@/lib/listings/events';
import { ANON_COOKIE_NAME } from '@/lib/listings/recent-views';
import { PROPERTY_EVENT_TYPES, type PropertyEventType } from '@/db/schema';

export const runtime = 'edge';

/**
 * POST /api/properties/:id/event
 *
 * Body: `{ eventType: string, source?: string, metadata?: object }`
 *
 * Generic client-side analytics event endpoint. Used by:
 *   - <PropertyGallery>     → 'image_gallery_open' on first image click
 *   - <ContactSection>      → 'whatsapp_click' / 'phone_click' / 'email_click'
 *   - <ShareButton>         → 'share_click' (when phase 5 ships)
 *
 * Server-side analytics (property_view via /view route, lead_form_submit
 * via /leads, favorite_add via /favorite) don't go through this endpoint
 * — they fan into property_events directly from their own routes since
 * they already have privileged context.
 *
 * Identity: signed-in user's id from session, anonymous_id from the
 * `aho_anon_id` cookie (set lazily by /view on first property visit).
 * Both can be null — analytics still records the engagement signal.
 *
 * Best-effort: insert failures return 200 (analytics dropping doesn't
 * affect UX). Validation errors do return 400 to catch coding bugs.
 *
 * NOT allowed event types from the client (they have privileged
 * server-side write paths):
 *   - 'property_view'      → use POST /view
 *   - 'lead_form_submit'   → fired by POST /api/leads
 *   - 'favorite_add'       → fired by POST /favorite
 *
 * If the client requests one of those, respond 400 to surface the bug.
 */

const ParamSchema = z.object({ id: z.string().uuid() });

const CLIENT_ALLOWED: ReadonlySet<PropertyEventType> = new Set([
  'image_gallery_open',
  'whatsapp_click',
  'phone_click',
  'email_click',
  'share_click',
]);

const BodySchema = z.object({
  eventType: z.enum(PROPERTY_EVENT_TYPES),
  source: z.string().max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const raw = await params;
  const parsedParams = ParamSchema.safeParse(raw);
  if (!parsedParams.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }
  const propertyId = parsedParams.data.id;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_body' }, { status: 400 });
  }
  const parsedBody = BodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_body' }, { status: 400 });
  }
  const { eventType, source, metadata } = parsedBody.data;

  // Reject events that have their own server-side write paths.
  if (!CLIENT_ALLOWED.has(eventType)) {
    return NextResponse.json(
      { ok: false, errorCode: 'event_type_not_client_allowed' },
      { status: 400 },
    );
  }

  // Resolve property + org_id. The lookup also gates events on the
  // listing being publicly visible — drops events fired against
  // archived/draft/sold listings.
  const userClient = await createServerSupabaseClient();
  const { data: prop, error: propErr } = await userClient
    .from('properties')
    .select('id, status, published_at, org_id')
    .eq('id', propertyId)
    .maybeSingle();
  if (propErr) {
    console.warn('[event] property lookup', propErr);
    // Don't surface the error — analytics writes are best-effort.
    return NextResponse.json({ ok: true, recorded: false });
  }
  if (!prop || prop.status !== 'active' || !prop.published_at) {
    return NextResponse.json({ ok: true, recorded: false });
  }

  // Identity.
  const { data: userResult } = await userClient.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const anonymousId = req.cookies.get(ANON_COOKIE_NAME)?.value ?? null;

  await recordPropertyEvent({
    supabase: createAdminClient(),
    propertyId,
    orgId: prop.org_id as string,
    eventType,
    userId,
    anonymousId,
    source: source ?? null,
    metadata: metadata ?? {},
  });

  return NextResponse.json({ ok: true, recorded: true });
}
