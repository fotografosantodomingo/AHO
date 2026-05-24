import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ImportedFacts } from '@/lib/listings/import-from-url';
import { buildVideoScript } from '@/lib/creative/video-script';
import {
  SUPPORTED_MARKETS,
  localeToMarket,
  type Market,
} from '@/lib/social/market-prompts';
import { LOCALES, type Locale } from '@/i18n/config';

export const runtime = 'edge';

/**
 * /api/audit/[id]/video — Phase 4 slice 4a.
 *
 * POST  → enqueue a render job. Body: { locale?: Locale }. Defaults
 *         to 'en'. Returns { ok, jobId, status }. Inserts an
 *         audit_videos row with status='queued'; the video-render
 *         container (workers/video-render/) picks it up via the
 *         Cloudflare Queue (slice 4b) and flips status to
 *         'rendering' → 'ready' | 'failed'.
 *
 * GET   → poll status. Returns the latest audit_videos row for this
 *         audit + locale (most recent first). UI polls every 2-3s
 *         while status ∈ {queued, rendering}; stops on ready/failed.
 *
 * Ownership: POST requires the audit be claimed by the requester
 * (mirrors /publish). GET is public — the preview page renders the
 * video inline for any visitor (parallels how the 9 captions are
 * publicly visible).
 *
 * Container status: as of slice 4a v1, the workers/video-render/
 * container is NOT YET DEPLOYED. POST inserts the row but no
 * renderer is listening; GET returns status='queued' forever. The
 * UI side surfaces "render coming soon" until the container is
 * deployed in slice 4b. The DB shape is forward-compatible with
 * the real container coming online.
 */

const PostBodySchema = z.object({
  locale: z
    .enum(LOCALES as unknown as [Locale, ...Locale[]])
    .optional()
    .default('en'),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: auditId } = await ctx.params;

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }
  const userId = userResult.user.id;

  let body: z.infer<typeof PostBodySchema>;
  try {
    body = PostBodySchema.parse(await req.json().catch(() => ({})));
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'invalid_input', hint: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
  const locale = body.locale ?? 'en';
  const market: Market = localeToMarket(locale);
  if (!SUPPORTED_MARKETS.includes(market)) {
    return NextResponse.json(
      { ok: false, error: 'unsupported_market', hint: market },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: audit } = await admin
    .from('ai_audits')
    .select('id, facts, claimed_by_user_id')
    .eq('id', auditId)
    .maybeSingle();
  if (!audit) {
    return NextResponse.json({ ok: false, error: 'audit_not_found' }, { status: 404 });
  }
  if (audit.claimed_by_user_id && audit.claimed_by_user_id !== userId) {
    return NextResponse.json({ ok: false, error: 'not_owner' }, { status: 403 });
  }

  const facts = audit.facts as ImportedFacts;
  const photos = (facts.photoUrls ?? []).filter((u) => u.startsWith('https://'));
  if (photos.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'no_photos', hint: 'Video render requires at least one HTTPS photo from the source listing' },
      { status: 422 },
    );
  }

  // Build the script up-front so the container has a fully-resolved
  // composition spec; saves the container from re-fetching facts.
  // Stored in JSONB column would be a Phase 4b enhancement; for v1
  // we just compute it to validate the script is buildable, then
  // discard. The Container re-derives via a second route call later.
  const _script = buildVideoScript({ facts, market, locale });
  void _script;

  const { data: inserted, error: insertErr } = await admin
    .from('audit_videos')
    .insert({
      audit_id: auditId,
      market,
      status: 'queued',
    })
    .select('id, status')
    .single();
  if (insertErr || !inserted) {
    console.error('[audit/video] insert failed', insertErr);
    return NextResponse.json(
      { ok: false, error: 'db_error' },
      { status: 500 },
    );
  }

  // Phase 4b will enqueue on q.video-gen here. For v1 the row sits
  // at status='queued' until the container is deployed + starts
  // consuming.
  // TODO(4b): env.QUEUE_VIDEO_GEN.send({ jobId: inserted.id, auditId, market });

  return NextResponse.json({
    ok: true,
    jobId: inserted.id,
    status: inserted.status,
    locale,
    market,
    pending: true,
    hint: 'Render container deploys in slice 4b — row queued, awaiting consumer.',
  });
}

/**
 * Poll the latest render for (audit, locale → market). Returns the
 * most-recent audit_videos row matching the requested market. Public:
 * no auth required (mirrors the public-read RLS on audit_videos).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: auditId } = await ctx.params;
  const url = new URL(req.url);
  const localeParam = url.searchParams.get('locale') ?? 'en';
  const locale: Locale = (LOCALES as readonly string[]).includes(localeParam)
    ? (localeParam as Locale)
    : 'en';
  const market: Market = localeToMarket(locale);

  const admin = createAdminClient();
  const { data: row } = await admin
    .from('audit_videos')
    .select('id, status, market, r2_key, duration_s, error_code, error_message, render_ms, created_at, rendered_at')
    .eq('audit_id', auditId)
    .eq('market', market)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ ok: true, status: 'none', market });
  }
  return NextResponse.json({
    ok: true,
    jobId: row.id,
    status: row.status,
    market: row.market,
    r2Key: row.r2_key,
    durationS: row.duration_s,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    renderMs: row.render_ms,
    createdAt: row.created_at,
    renderedAt: row.rendered_at,
  });
}
