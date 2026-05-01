import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { REVIEW_TOKEN_LENGTH } from '@/lib/reviews/token';

export const runtime = 'edge';

/**
 * POST /api/reviews/verify
 *
 * Body: { token: string (32 hex chars) }
 *
 * Calls the SECURITY DEFINER function `verify_review_token` which does
 * the atomic find + status flip from 'pending_verification' to
 * 'pending_moderation'. The function handles invalid/expired tokens
 * with a typed error code so we don't leak whether a token is unknown
 * vs. expired (timing-attack hardening, even though token entropy is
 * 128 bits).
 */

const VerifySchema = z.object({
  token: z.string().length(REVIEW_TOKEN_LENGTH).regex(/^[0-9a-f]+$/),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }

  const parsed = VerifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_token_format' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('verify_review_token', {
    p_token: parsed.data.token,
  });

  if (error) {
    console.error('[POST /api/reviews/verify] rpc failed', error);
    return NextResponse.json(
      { ok: false, errorCode: 'verify_failed' },
      { status: 500 },
    );
  }

  // The RPC returns a single row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || row.success !== true) {
    return NextResponse.json(
      { ok: false, errorCode: row?.error_code ?? 'invalid_or_expired' },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, reviewId: row.review_id });
}
