import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordEvent } from '@/lib/ai/conversation-events';

export const runtime = 'edge';

/**
 * POST /api/dashboard/ai-inbox/reject
 *
 * Reject a pending AI assistant draft. Marks the row as
 * `approval_status='rejected'`. v2: this should optionally trigger a
 * redraft prompt; v1 just hides the row from the pending queue so the
 * agent can write a manual reply if needed.
 */

const BodySchema = z.object({
  messageId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_request', hint: err instanceof Error ? err.message : 'bad_body' },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = userResult.user.id;

  const { data: msg, error: msgErr } = await supabase
    .from('ai_conversation_messages')
    .select('id, role, approval_status, channel, conversation_id, created_at')
    .eq('id', body.messageId)
    .maybeSingle();
  if (msgErr) {
    console.error('[ai-inbox.reject] lookup error', {
      code: msgErr.code,
      message: msgErr.message,
    });
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!msg) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (msg.role !== 'assistant') {
    return NextResponse.json({ error: 'invalid_message_role' }, { status: 400 });
  }
  if (msg.approval_status !== 'pending') {
    return NextResponse.json({ ok: true, alreadyHandled: true });
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await admin
    .from('ai_conversation_messages')
    .update({
      approval_status: 'rejected',
      approved_by: userId,
      approved_at: nowIso,
    })
    .eq('id', body.messageId);
  if (updateErr) {
    console.error('[ai-inbox.reject] update error', {
      code: updateErr.code,
      message: updateErr.message,
    });
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Funnel event — rejected drafts are the strongest signal of bad
  // AI output. Admin /admin/ai-overview shows the rejected/total
  // ratio per market so we can spot prompt regressions early.
  const { data: conv } = await admin
    .from('ai_conversations')
    .select('org_id, agent_id')
    .eq('id', msg.conversation_id)
    .maybeSingle();
  if (conv) {
    const msSincePending =
      msg.created_at != null
        ? new Date(nowIso).getTime() - new Date(msg.created_at as string).getTime()
        : null;
    await recordEvent({
      conversationId: msg.conversation_id as string,
      orgId: conv.org_id as string,
      agentId: (conv.agent_id as string | null) ?? null,
      channel: (msg.channel as 'web_chat' | 'email' | 'whatsapp' | 'voice') ?? 'web_chat',
      kind: 'rejected',
      payload: { messageId: body.messageId, rejectedBy: userId, msSincePending },
      supabase: admin,
    });
  }

  return NextResponse.json({ ok: true });
}
