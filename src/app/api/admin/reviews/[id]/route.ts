import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/brevo';
import { renderReviewPublishedEmail } from '@/lib/email/templates/review-published';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/admin/reviews/:id
 *
 * Body: { action: 'approve' | 'reject' | 'hide' | 'unhide', notes?: string }
 *
 * Admin moderation actions. Auth is RLS-gated (reviews_admin_update);
 * the route layer also checks is_admin for clean error semantics. The
 * protect_review_fields trigger stamps moderated_at + moderated_by
 * automatically when an admin changes the status.
 *
 * On 'approve' (status → 'published'), we send the agent a notification
 * email so they can log in and reply. Email failure is logged but does
 * not unwind the publish.
 */

const ActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'hide', 'unhide']),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const NEXT_STATUS: Record<z.infer<typeof ActionSchema>['action'], string> = {
  approve: 'published',
  reject: 'rejected',
  hide: 'hidden',
  unhide: 'published',
};

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
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_input', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json({ ok: false, errorCode: 'unauthenticated' }, { status: 401 });
  }
  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (!callerProfile?.is_admin) {
    return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
  }

  // Read the prior review for: (a) "approve" notification context,
  // (b) detecting illegal state transitions.
  const { data: prior } = await supabase
    .from('reviews')
    .select('id, agent_id, rating, body, locale, reviewer_name, status')
    .eq('id', reviewId)
    .maybeSingle();
  if (!prior) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  const newStatus = NEXT_STATUS[parsed.data.action];
  // Disallow approve/reject on already-published reviews — those should
  // use hide/unhide. Disallow hide on a non-published review.
  if (
    (parsed.data.action === 'approve' || parsed.data.action === 'reject') &&
    prior.status !== 'pending_moderation'
  ) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_transition', from: prior.status, action: parsed.data.action },
      { status: 409 },
    );
  }
  if (parsed.data.action === 'hide' && prior.status !== 'published') {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_transition', from: prior.status, action: parsed.data.action },
      { status: 409 },
    );
  }
  if (parsed.data.action === 'unhide' && prior.status !== 'hidden') {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_transition', from: prior.status, action: parsed.data.action },
      { status: 409 },
    );
  }

  const update: Record<string, unknown> = { status: newStatus };
  if (parsed.data.notes !== undefined) update.moderation_notes = parsed.data.notes;

  const { error: updateErr } = await supabase
    .from('reviews')
    .update(update)
    .eq('id', reviewId);
  if (updateErr) {
    if (updateErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[POST /api/admin/reviews/:id]', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: updateErr.message ?? 'db_error' },
      { status: 500 },
    );
  }

  // On approve (or unhide), send the published-review notification to
  // the agent. Fetch the agent's email + preferred locale + name —
  // admin session can read profiles via profiles_admin_select.
  if (newStatus === 'published') {
    const { data: agent } = await supabase
      .from('profiles')
      .select('email, full_name, preferred_language')
      .eq('id', prior.agent_id)
      .maybeSingle();
    if (agent?.email) {
      const { NEXT_PUBLIC_SITE_URL } = publicEnv();
      const agentLocale = (agent.preferred_language as string) === 'es' ? 'es' : 'en';
      const agentFirstName = (agent.full_name as string | null)?.split(/\s+/)[0] ?? '';
      // Look up org slug for the public profile link via organization_members.
      // Single-owner-per-org in v1, so this resolves to one row.
      const { data: orgRow } = await supabase
        .from('organization_members')
        .select('organizations!inner(slug)')
        .eq('user_id', prior.agent_id)
        .eq('role', 'owner')
        .limit(1)
        .maybeSingle();
      const orgsField = orgRow?.organizations as
        | { slug?: string }
        | { slug?: string }[]
        | null
        | undefined;
      const orgSlug = Array.isArray(orgsField)
        ? orgsField[0]?.slug
        : orgsField?.slug;
      const publicProfileUrl = orgSlug
        ? `${NEXT_PUBLIC_SITE_URL}/${agentLocale}/agents/${orgSlug}`
        : `${NEXT_PUBLIC_SITE_URL}/${agentLocale}`;
      const replyUrl = `${NEXT_PUBLIC_SITE_URL}/${agentLocale}/${
        agentLocale === 'es' ? 'panel/resenas' : 'dashboard/reviews'
      }`;

      const bodyExcerpt =
        (prior.body as string).length > 140
          ? (prior.body as string).slice(0, 140) + '…'
          : (prior.body as string);

      const email = renderReviewPublishedEmail({
        agentFirstName: agentFirstName || (agentLocale === 'es' ? 'agente' : 'agent'),
        reviewerName: prior.reviewer_name as string,
        rating: prior.rating as number,
        bodyExcerpt,
        locale: agentLocale,
        replyUrl,
        publicProfileUrl,
      });

      const sendResult = await sendEmail({
        to: agent.email as string,
        subject: email.subject,
        html: email.html,
      });
      if (!sendResult.sent) {
        console.warn('[POST /api/admin/reviews/:id] notification email not sent', {
          reviewId,
          error: sendResult.error,
        });
      }
    }
  }

  revalidatePath('/[locale]/admin/reviews', 'page');
  revalidatePath('/[locale]/agents/[slug]', 'page');
  revalidatePath('/[locale]/dashboard/reviews', 'page');
  return NextResponse.json({ ok: true, id: reviewId, status: newStatus });
}
