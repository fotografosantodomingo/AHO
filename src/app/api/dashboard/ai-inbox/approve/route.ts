import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordEvent } from '@/lib/ai/conversation-events';

export const runtime = 'edge';

/**
 * POST /api/dashboard/ai-inbox/approve
 *
 * Approve (and optionally edit) a pending AI assistant draft from the
 * dashboard inbox. Auth-required; the org of the caller is verified
 * against the parent conversation BEFORE the update runs.
 *
 * Body:
 *   { messageId: uuid, editedBody?: string }
 *
 * On success: 200 { ok: true }. Failures map to 401 / 403 / 404 / 500.
 *
 * Service-role write (after the auth + org check passes) lets us bypass
 * RLS for the actual UPDATE — RLS on ai_conversation_messages is read-
 * only for authenticated users; writes are routed through the API
 * layer (per CLAUDE.md hard rule #4 + migration 0066 design).
 */

const BodySchema = z.object({
  messageId: z.string().uuid(),
  editedBody: z.string().trim().min(1).max(8000).optional(),
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

  // ─── Auth ───────────────────────────────────────────────────────────
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = userResult.user.id;

  // ─── Load the message + its conversation + verify org membership ───
  // We use the user-scoped client here so RLS does the org-membership
  // gate for us — if the caller can read this message via the
  // `org_members_read_msg` policy, they belong to the org.
  const { data: msg, error: msgErr } = await supabase
    .from('ai_conversation_messages')
    .select('id, conversation_id, role, approval_status, body, channel, created_at')
    .eq('id', body.messageId)
    .maybeSingle();
  if (msgErr) {
    console.error('[ai-inbox.approve] message lookup error', {
      code: msgErr.code,
      message: msgErr.message,
    });
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 });
  }
  if (!msg) {
    // Either doesn't exist OR exists in another org (RLS hid it). 404.
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (msg.role !== 'assistant') {
    return NextResponse.json({ error: 'invalid_message_role' }, { status: 400 });
  }
  if (msg.approval_status !== 'pending') {
    // Idempotency / double-click guard. The caller might be racing
    // against another agent in the same org; treat already-approved
    // as success rather than a hard error.
    return NextResponse.json({ ok: true, alreadyApproved: true });
  }

  // ─── Apply the approval via the admin client ───────────────────────
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    approval_status: 'approved',
    approved_by: userId,
    approved_at: nowIso,
    sent_at: nowIso,
  };
  if (body.editedBody !== undefined) {
    updatePayload.body = body.editedBody;
  }
  const { error: updateErr } = await admin
    .from('ai_conversation_messages')
    .update(updatePayload)
    .eq('id', body.messageId);
  if (updateErr) {
    console.error('[ai-inbox.approve] update error', {
      code: updateErr.code,
      message: updateErr.message,
      details: updateErr.details,
    });
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }

  // Bump the conversation's last_message_at so dashboard sort orders
  // reflect the human action.
  const { error: bumpErr } = await admin
    .from('ai_conversations')
    .update({ last_message_at: nowIso })
    .eq('id', msg.conversation_id);
  if (bumpErr) {
    // Soft-fail — the approval landed, the sort order is just slightly
    // stale until the next message arrives.
    console.warn('[ai-inbox.approve] conversation bump warn', bumpErr);
  }

  // Funnel event — distinguish a plain approval from an edit-and-
  // send. The dashboard analytics uses the ratio of edits to plain
  // approvals as a proxy for AI draft quality.
  const wasEdited =
    body.editedBody !== undefined && body.editedBody !== (msg.body as string | null);
  // Resolve org_id + agent_id for the event row. The msg row has
  // conversation_id; one short lookup gets us the rest.
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
      kind: wasEdited ? 'edited' : 'approved',
      payload: {
        messageId: body.messageId,
        approvedBy: userId,
        msSincePending,
        bodyChangedChars: wasEdited
          ? Math.abs(((body.editedBody as string).length ?? 0) - ((msg.body as string | null)?.length ?? 0))
          : 0,
      },
      supabase: admin,
    });
  }

  return NextResponse.json({ ok: true });
}
