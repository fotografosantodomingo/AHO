import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * POST /api/reviews/:id/reply
 *
 * The target agent posts (or updates) their public reply to a published
 * review. Single reply per review; subsequent calls overwrite. Set body
 * to null to clear the reply.
 *
 * RLS handles row scope (reviews_agent_reply policy + the
 * protect_review_fields trigger restricts column scope to agent_reply).
 * If the caller isn't the target agent or the review isn't published,
 * RLS denies and we return 403.
 */

const ReplySchema = z.object({
  body: z.string().trim().min(10).max(2000).nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, errorCode: 'invalid_id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, errorCode: 'invalid_json' }, { status: 400 });
  }
  const parsed = ReplySchema.safeParse(body);
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

  const { data: updated, error } = await supabase
    .from('reviews')
    .update({ agent_reply: parsed.data.body })
    .eq('id', id)
    .select('id')
    .single();

  if (error) {
    if (error.code === '42501') {
      return NextResponse.json({ ok: false, errorCode: 'forbidden' }, { status: 403 });
    }
    console.error('[POST /api/reviews/:id/reply]', error);
    return NextResponse.json(
      { ok: false, errorCode: error.message ?? 'db_error' },
      { status: 500 },
    );
  }
  if (!updated) {
    return NextResponse.json({ ok: false, errorCode: 'not_found' }, { status: 404 });
  }

  // Refresh the agent's public profile so the new reply is visible.
  revalidatePath('/[locale]/agents/[slug]', 'page');
  return NextResponse.json({ ok: true, id: updated.id });
}
