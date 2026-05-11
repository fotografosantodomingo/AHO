import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/brevo';
import { renderReviewVerificationEmail } from '@/lib/email/templates/review-verification';
import { generateVerificationToken, REVIEW_TOKEN_TTL_MS } from '@/lib/reviews/token';
import { publicEnv } from '@/lib/env';
import { LOCALES, narrowContentLocale } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/reviews
 *
 * Submit a review of an agent. Open to anon and authenticated callers
 * (the platform-wide aim is buyer-side; many reviewers will not have an
 * AHO account). The review enters status='pending_verification' — an
 * email is sent to the reviewer's address with a verify-token link.
 * Once verified, the review moves to 'pending_moderation' and waits for
 * admin approval before becoming public.
 *
 * Anti-abuse posture for v1:
 *   - Email-token verification is the primary spam gate (a bot needs a
 *     working inbox to verify, which kills 99% of script abuse).
 *   - Admin moderation is the second gate.
 *   - Turnstile NOT required here in v1 — adds friction in markets
 *     where Cloudflare is sometimes throttled, and the email gate
 *     already covers the threat. Reconsider in A6 (lead-quality).
 *
 * Self-review prevention:
 *   - DB-level CHECK constraint reviews_no_self_review blocks signed-in
 *     callers from reviewing themselves (reviewer_user_id = agent_id).
 *   - For anonymous-via-email reviews, we cannot prove the reviewer is
 *     not the agent on a different email — admin moderation catches it.
 */

const ReviewSchema = z.object({
  agent_id: z.string().uuid(),
  property_id: z.string().uuid().optional().nullable(),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(50).max(5000),
  reviewer_email: z.string().trim().email().toLowerCase(),
  reviewer_name: z.string().trim().min(1).max(120),
  locale: z.enum(LOCALES).default('en'),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }

  const parsed = ReviewSchema.safeParse(body);
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
  const data = parsed.data;

  // Resolve caller identity from cookie session for self-review check
  // and for stamping reviewer_user_id when signed in. The actual INSERT
  // uses the admin client below — `INSERT ... RETURNING` evaluates SELECT
  // RLS on the new row, and anon's only SELECT policy requires
  // `status='published'`, so a user-context insert of a brand-new
  // `pending_verification` row would always 42501. Same pattern as
  // `/api/leads` per `docs/HANDOFF.md` §17.3.
  const userClient = await createServerSupabaseClient();
  const { data: userResult } = await userClient.auth.getUser();
  const reviewerUserId = userResult.user?.id ?? null;

  // Self-review check at the route layer for a clean error message; the
  // DB CHECK is the actual guarantee.
  if (reviewerUserId && reviewerUserId === data.agent_id) {
    return NextResponse.json(
      { ok: false, errorCode: 'self_review_forbidden' },
      { status: 403 },
    );
  }

  const supabase = createAdminClient();

  // Resolve the target agent name for the verification email. When a
  // property_id is supplied, the existing `get_listing_contact` RPC
  // gives us `agent_full_name` cleanly. For agent-profile-page reviews
  // (no property_id) we read the profile directly through the admin
  // client. Falls back to the generic "the agent" if the row is gone.
  let agentDisplayName = 'the agent';
  if (data.property_id) {
    const { data: contact } = await supabase.rpc('get_listing_contact', {
      p_property_id: data.property_id,
    });
    const row = Array.isArray(contact) ? contact[0] : contact;
    const fromContact = row?.agent_full_name as string | undefined;
    if (fromContact) agentDisplayName = fromContact;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', data.agent_id)
      .maybeSingle();
    if (profile?.full_name) agentDisplayName = profile.full_name;
  }

  const { token, expiresAt } = generateVerificationToken();

  const { data: inserted, error: insertErr } = await supabase
    .from('reviews')
    .insert({
      agent_id: data.agent_id,
      reviewer_user_id: reviewerUserId,
      reviewer_email: data.reviewer_email,
      reviewer_name: data.reviewer_name,
      property_id: data.property_id ?? null,
      rating: data.rating,
      body: data.body,
      locale: data.locale,
      status: 'pending_verification',
      verification_token: token,
      verification_token_expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertErr) {
    // 23514 = check_violation. Most common: self_review_forbidden when
    // an authenticated user tried to review themselves and slipped past
    // the route-layer check (race: signed in mid-request).
    if (insertErr.code === '23514') {
      return NextResponse.json(
        { ok: false, errorCode: 'check_violation', detail: insertErr.message },
        { status: 400 },
      );
    }
    if (insertErr.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[POST /api/reviews] insert failed', insertErr);
    return NextResponse.json(
      { ok: false, errorCode: 'insert_failed', detail: insertErr.message },
      { status: 500 },
    );
  }

  const { NEXT_PUBLIC_SITE_URL } = publicEnv();
  const verifyUrl = `${NEXT_PUBLIC_SITE_URL}/${data.locale}/reviews/verify/${token}`;

  const email = renderReviewVerificationEmail({
    reviewerName: data.reviewer_name,
    agentName: agentDisplayName,
    // Email content is bilingual EN/ES; narrow PL/PT/DE/FR/IT to EN.
    locale: narrowContentLocale(data.locale),
    verifyUrl,
    expiresInHours: Math.floor(REVIEW_TOKEN_TTL_MS / (60 * 60 * 1000)),
  });

  // Email failure does NOT unwind the insert — the reviewer can request
  // a re-send later (TODO for A6). Better to keep the row + log the
  // delivery failure than to silently lose the submission.
  const sendResult = await sendEmail({
    to: data.reviewer_email,
    subject: email.subject,
    html: email.html,
  });
  if (!sendResult.sent) {
    console.warn('[POST /api/reviews] verification email not sent', {
      reviewId: inserted.id,
      error: sendResult.error,
    });
  }

  return NextResponse.json(
    { ok: true, id: inserted.id, emailSent: sendResult.sent },
    { status: 201 },
  );
}
