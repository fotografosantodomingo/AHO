import { type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * GET /api/ai-chat/poll?conversationId=<uuid>&sessionToken=<opaque>
 *
 * The buyer-facing AI-chat widget polls this endpoint every ~5s to
 * pick up agent-side state changes — specifically:
 *   - An assistant draft that was `pending` and is now `approved`
 *     (the buyer should drop the "(awaiting agent review)" badge).
 *   - An assistant draft whose body was edited by the agent before
 *     send (the buyer's visible text should update to match).
 *   - An assistant draft that was `rejected` (the buyer should hide
 *     the message; the agent will redraft or take over manually).
 *
 * Authz model for an anonymous buyer:
 *   - The conversation's `buyer_session_token` is checked against the
 *     sessionToken query parameter. If they don't match → 403.
 *   - This prevents random walkers from listing conversations they
 *     didn't start. The session token is generated client-side as a
 *     `crypto.randomUUID()` on first widget open and persisted to
 *     localStorage; it's already stored on the conversation row.
 *
 * Why this exists instead of WebSockets / SSE-only:
 *   - The Cloudflare Pages Edge runtime doesn't expose persistent
 *     server-pushed sockets to anonymous browsers cleanly. A 5s poll
 *     is dirt-cheap (Edge cost ≈ $0 at our volumes), survives
 *     refreshes / connection drops without state, and keeps the buyer
 *     widget code path identical regardless of channel (the dashboard
 *     can push approvals via /api/dashboard/ai-inbox/approve and the
 *     buyer's widget reflects it within the next poll cycle).
 *
 * Returned shape:
 *   { ok: true, messages: Array<{ id, role, body, approval_status,
 *     created_at, sent_at }> }
 *   - Includes BOTH user + assistant rows so the widget can also
 *     hydrate after a hard reload from the session token alone.
 *   - Pending assistant rows ARE included (the widget shows them
 *     with the "(awaiting agent review)" badge today; D2 flip
 *     removes the badge).
 *   - Rejected assistant rows are filtered out — the buyer never
 *     sees a draft that the agent killed.
 */
export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get('conversationId');
  const sessionToken = req.nextUrl.searchParams.get('sessionToken');
  if (!conversationId || !sessionToken) {
    return new Response(
      JSON.stringify({ ok: false, errorCode: 'missing_param' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const admin = createAdminClient();

  // Conversation lookup + session-token check. The token must match
  // the value persisted at conversation-creation time; otherwise this
  // is someone else's conversation (or a bot fishing).
  const { data: conv, error: convErr } = await admin
    .from('ai_conversations')
    .select('id, buyer_session_token, status')
    .eq('id', conversationId)
    .maybeSingle();
  if (convErr) {
    console.error('[ai-chat-poll] conversation lookup error', convErr);
    return new Response(
      JSON.stringify({ ok: false, errorCode: 'lookup_failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
  if (!conv) {
    return new Response(
      JSON.stringify({ ok: false, errorCode: 'not_found' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    );
  }
  if (conv.buyer_session_token !== sessionToken) {
    return new Response(
      JSON.stringify({ ok: false, errorCode: 'forbidden' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }

  // Messages — filter out rejected drafts (the buyer should never see
  // a message the agent killed). Pending rows ARE returned; the widget
  // renders them with the badge. Service-role bypasses RLS since the
  // session-token check above is the authz primitive here.
  const { data: rows, error: rowsErr } = await admin
    .from('ai_conversation_messages')
    .select('id, role, body, approval_status, created_at, sent_at')
    .eq('conversation_id', conversationId)
    .or('approval_status.is.null,approval_status.in.(pending,approved,auto_sent)')
    .order('created_at', { ascending: true })
    .limit(200);
  if (rowsErr) {
    console.error('[ai-chat-poll] messages lookup error', rowsErr);
    return new Response(
      JSON.stringify({ ok: false, errorCode: 'lookup_failed' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      status: conv.status,
      messages: rows ?? [],
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        // Short-lived cache so a burst of widget polls inside the
        // same second hits the edge cache instead of Supabase. 2s is
        // a sweet spot: long enough to absorb a rapid open/close,
        // short enough that the agent's approval is visible within
        // the next poll cycle.
        'cache-control': 'private, max-age=2',
      },
    },
  );
}
