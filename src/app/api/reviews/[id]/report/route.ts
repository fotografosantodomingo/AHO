import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { REVIEW_REPORT_REASONS } from '@/db/schema';

export const runtime = 'edge';

/**
 * POST /api/reviews/:id/report
 *
 * Anyone can report a published review. Inserts a `review_reports` row
 * with status='open' for admin triage. Reports do NOT auto-hide the
 * review — admin makes the call. This is the deliberate v1 posture
 * (auto-hide invites brigading); revisit at v1.1 if abuse rate
 * justifies a threshold-based auto-hide.
 *
 * Anti-abuse for v1:
 *   - One open report per (review_id, reporter_user_id) pair when
 *     authenticated — enforced at the route layer (idempotent insert).
 *   - Anonymous reports: no per-IP throttle yet (will land in A6
 *     alongside Turnstile + the same lead-form rate-limit work).
 */

const ReportSchema = z.object({
  reason: z.enum(REVIEW_REPORT_REASONS),
  notes: z.string().trim().max(2000).optional().nullable(),
  reporter_email: z.string().trim().email().toLowerCase().optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: reviewId } = await params;
  if (!z.string().uuid().safeParse(reviewId).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = ReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_input', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const reporterUserId = userResult.user?.id ?? null;

  // Idempotency: signed-in user reporting the same review twice is a
  // no-op. Anon reports always insert (no identity to dedup against).
  if (reporterUserId) {
    const { data: existing } = await supabase
      .from('review_reports')
      .select('id')
      .eq('review_id', reviewId)
      .eq('reporter_user_id', reporterUserId)
      .eq('status', 'open')
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, id: existing.id, deduped: true });
    }
  }

  const { data: inserted, error } = await supabase
    .from('review_reports')
    .insert({
      review_id: reviewId,
      reporter_user_id: reporterUserId,
      reporter_email: parsed.data.reporter_email ?? null,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
      status: 'open',
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    if (error.code === '23503') {
      // FK violation — review_id doesn't exist.
      return NextResponse.json({ ok: false, errorCode: 'review_not_found' }, { status: 404 });
    }
    console.error('[POST /api/reviews/:id/report]', error);
    return NextResponse.json(
      { ok: false, errorCode: error.message ?? 'db_error' },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, id: inserted.id }, { status: 201 });
}
