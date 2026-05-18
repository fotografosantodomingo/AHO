import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Funnel-event recorder for the AI Conversion Stack (Phase 1 of
 * docs/AI_CONVERSION_PLAN.md). Every meaningful moment in an AI
 * conversation calls `recordEvent({...})` here:
 *
 *   started, message_user, draft_pending, approved, edited,
 *   auto_sent, rejected, escalated, lead_captured, viewing_booked,
 *   abandoned
 *
 * Why a helper instead of inline supabase.from('ai_conversation_events')
 * .insert(): cost containment + future evolution.
 *   - The rollup cron at 02:00 UTC pulls from this table. If the
 *     table schema evolves (new columns, new kinds), every caller
 *     picks it up automatically.
 *   - Errors are caught + logged via console.error and NEVER bubble
 *     up. A funnel-event write failure must not cascade into a
 *     user-visible 5xx on the AI chat endpoint.
 *   - Callers don't need to remember to await — but they should,
 *     per CLAUDE.md Edge-runtime gotcha. The helper IS async; the
 *     callers' `await` keeps the promise alive until the handler
 *     returns (otherwise CF Pages drops it on response close).
 *
 * Reads-after-write: there are none. The dashboard analytics tab
 * reads from `ai_daily_stats` (built by the cron), not from this
 * raw stream. So even if a few events are lost to errors, the
 * derived metrics degrade gracefully without breaking anything.
 */

export type AiEventKind =
  | 'started'
  | 'message_user'
  | 'draft_pending'
  | 'approved'
  | 'edited'
  | 'auto_sent'
  | 'rejected'
  | 'escalated'
  | 'lead_captured'
  | 'viewing_booked'
  | 'abandoned';

export type AiEventChannel = 'web_chat' | 'email' | 'whatsapp' | 'voice';

export interface RecordEventInput {
  /** ID of the parent ai_conversations row. Required. */
  conversationId: string;
  /** Org owning the conversation. Denormalized; passed by the caller
   *  so we avoid a join-back to resolve it. */
  orgId: string;
  /** Owning agent (the human, not the AI persona). Nullable for
   *  org-level conversations; v1 always set. */
  agentId: string | null;
  channel: AiEventChannel;
  kind: AiEventKind;
  /** Per-event metadata. Structure varies by kind — see migration
   *  0071's comment for the well-known shapes. */
  payload?: Record<string, unknown>;
  /** Optional admin client override; defaults to the standard
   *  `createAdminClient()`. Lets tests inject a mock. */
  supabase?: SupabaseClient;
}

export async function recordEvent(input: RecordEventInput): Promise<void> {
  try {
    const admin = input.supabase ?? createAdminClient();
    // Destructure the postgrest response per CLAUDE.md gotcha —
    // supabase-js doesn't throw on row-level errors.
    const { error } = await admin.from('ai_conversation_events').insert({
      conversation_id: input.conversationId,
      org_id: input.orgId,
      agent_id: input.agentId,
      channel: input.channel,
      kind: input.kind,
      payload: input.payload ?? null,
    });
    if (error) {
      console.error('[ai-event] postgrest error', {
        code: error.code,
        message: error.message,
        details: error.details,
        kind: input.kind,
        conversationId: input.conversationId,
      });
    }
  } catch (err) {
    // Network-level / unexpected failure. Drop the event + log;
    // never propagate to the caller. The downstream rollup is
    // resilient to dropped events (no data integrity invariants
    // depend on every event being present).
    console.error('[ai-event] insert threw', err);
  }
}
