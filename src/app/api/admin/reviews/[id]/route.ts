import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/brevo';
import { renderReviewPublishedEmail } from '@/lib/email/templates/review-published';
import { renderReviewApprovedReviewerEmail } from '@/lib/email/templates/review-approved-reviewer';
import { renderReviewRejectedReviewerEmail } from '@/lib/email/templates/review-rejected-reviewer';
import { publicEnv } from '@/lib/env';
import { narrowContentLocale, type Locale } from '@/i18n/config';

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

  // Read the prior review for: (a) approve/reject notification context,
  // (b) detecting illegal state transitions. reviewer_email is needed
  // to send the closing-loop email back to the reviewer on either
  // outcome (approve → "your review is live"; reject → "we didn't
  // publish it, here's why").
  const { data: prior } = await supabase
    .from('reviews')
    .select('id, agent_id, rating, body, locale, reviewer_name, reviewer_email, status')
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

  // Notification fan-out for approve/reject/unhide. Reviewer always
  // gets the closing-loop email (the verification flow promised them
  // we'd come back); the agent only gets pinged on publish (approve +
  // unhide). Hide is admin-internal — neither party needs an email.
  if (newStatus === 'published' || parsed.data.action === 'reject') {
    const { data: agent } = await supabase
      .from('profiles')
      .select('email, full_name, preferred_language')
      .eq('id', prior.agent_id)
      .maybeSingle();

    const agentFullName = (agent?.full_name as string | null) ?? '';
    const agentFirstName = agentFullName.split(/\s+/)[0] ?? '';
    const reviewerLocale = narrowContentLocale(prior.locale as Locale);
    const bodyExcerpt =
      (prior.body as string).length > 140
        ? (prior.body as string).slice(0, 140) + '…'
        : (prior.body as string);

    // Resolve the public profile URL once — used by both the
    // reviewer's "now published" email and the agent's existing
    // notification. Single owner per org in v1.
    const { NEXT_PUBLIC_SITE_URL } = publicEnv();
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

    // ---------- Reviewer email ----------
    const reviewerEmail = prior.reviewer_email as string | null;
    if (reviewerEmail) {
      const reviewerProfileUrl = orgSlug
        ? `${NEXT_PUBLIC_SITE_URL}/${reviewerLocale}/${
            reviewerLocale === 'es' ? 'agentes' : 'agents'
          }/${orgSlug}`
        : `${NEXT_PUBLIC_SITE_URL}/${reviewerLocale}`;

      const reviewerEmailRendered =
        newStatus === 'published'
          ? renderReviewApprovedReviewerEmail({
              reviewerName: prior.reviewer_name as string,
              agentName: agentFullName || (reviewerLocale === 'es' ? 'el agente' : 'the agent'),
              rating: prior.rating as number,
              bodyExcerpt,
              locale: reviewerLocale,
              publicProfileUrl: reviewerProfileUrl,
            })
          : renderReviewRejectedReviewerEmail({
              reviewerName: prior.reviewer_name as string,
              agentName: agentFullName || (reviewerLocale === 'es' ? 'el agente' : 'the agent'),
              locale: reviewerLocale,
              moderationNotes: parsed.data.notes ?? null,
            });

      const reviewerSend = await sendEmail({
        to: reviewerEmail,
        subject: reviewerEmailRendered.subject,
        html: reviewerEmailRendered.html,
      });
      if (!reviewerSend.sent) {
        console.warn('[POST /api/admin/reviews/:id] reviewer email not sent', {
          reviewId,
          status: newStatus,
          error: reviewerSend.error,
        });
      }
    }

    // ---------- Agent email (publish only) ----------
    if (newStatus === 'published' && agent?.email) {
      const agentLocale = (agent.preferred_language as string) === 'es' ? 'es' : 'en';
      const publicProfileUrl = orgSlug
        ? `${NEXT_PUBLIC_SITE_URL}/${agentLocale}/agents/${orgSlug}`
        : `${NEXT_PUBLIC_SITE_URL}/${agentLocale}`;
      const replyUrl = `${NEXT_PUBLIC_SITE_URL}/${agentLocale}/${
        agentLocale === 'es' ? 'panel/resenas' : 'dashboard/reviews'
      }`;

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
        console.warn('[POST /api/admin/reviews/:id] agent notification email not sent', {
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
