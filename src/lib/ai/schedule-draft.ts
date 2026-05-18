import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchKnowledge } from '@/lib/ai/knowledge';
import {
  buildAgentSystemPrompt,
  type AgentChannel,
  type AgentMarket,
} from '@/lib/ai/agent-prompts';
import { converse, type ConverseMessage } from '@/lib/ai/converse';
import { classifyAssistantTurn } from '@/lib/ai/gating';
import { getOrgPlanId, planTierLabel } from '@/lib/billing/plan-gating';
import { mapBillingTierToAgentTier } from '@/lib/ai/agent-tier';
import type { Locale } from '@/i18n/config';

/**
 * Asynchronously draft an AI reply for a conversation whose latest
 * turn is a user message that hasn't been responded to yet.
 *
 * v1 implementation: synchronous call to the same orchestrator stack
 * the web-chat /api/ai-chat route uses, wrapped in a fire-and-forget
 * Promise that the CALLER must await-via-`ctx.waitUntil` OR
 * await-explicitly. NO Cloudflare Queue at v1 — that's a later
 * polish slice. The trade-off:
 *   + simpler ops, one less infra primitive
 *   + same trust boundary as the inbound route
 *   - if Anthropic 5xxs, the buyer's user-turn is persisted but no
 *     assistant draft lands; agent sees the user-turn in /dashboard/
 *     ai-inbox without a draft and can respond manually
 *
 * Per CLAUDE.md gotcha: Cloudflare Edge runtime kills unawaited
 * promises. Either the caller uses `ctx.waitUntil(scheduleDraft(...))`
 * inside the Edge route (next-on-pages doesn't expose `ctx` cleanly,
 * so the alternative is to await directly before returning 200 —
 * adds latency but the buyer doesn't see it because they're not
 * waiting on this HTTP response anyway).
 *
 * Recommended call pattern in the inbound route:
 *   await scheduleDraft({ supabase, conversationId, agentId, orgId });
 *   return new Response(JSON.stringify({ ok: true }), { status: 200 });
 */
export interface ScheduleDraftArgs {
  supabase: SupabaseClient;
  conversationId: string;
  agentId: string;
  orgId: string;
}

export interface ScheduleDraftResult {
  ok: boolean;
  messageId?: string;
  errorCode?: string;
}

const HISTORY_TURN_LIMIT = 30;

/**
 * Maps the org's headquarters_country to the AgentMarket bucket used
 * by the system prompt. Anything we don't recognize falls back to
 * 'us' (English / pragmatic copy). Mirrors `/api/ai-chat/route.ts`
 * `countryToMarket`.
 */
function countryToMarket(country: string | null | undefined): AgentMarket {
  if (!country) return 'us';
  const c = country.toUpperCase();
  if (c === 'ES') return 'es';
  if (c === 'PL') return 'pl';
  if (c === 'PT' || c === 'BR') return 'pt';
  if (c === 'DE' || c === 'AT' || c === 'CH') return 'de';
  if (c === 'FR') return 'fr';
  if (c === 'IT') return 'it';
  return 'us';
}

export async function scheduleDraft(
  args: ScheduleDraftArgs,
): Promise<ScheduleDraftResult> {
  const { supabase, conversationId, agentId, orgId } = args;

  try {
    // ─── 1. Load the conversation; verify org match ──────────────────
    const { data: conversation, error: convErr } = await supabase
      .from('ai_conversations')
      .select(
        'id, org_id, agent_id, property_id, channel, buyer_locale',
      )
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) {
      console.error('[schedule-draft] conversation_lookup_error', {
        code: convErr.code,
        message: convErr.message,
        details: convErr.details,
        hint: convErr.hint,
        conversationId,
      });
      return { ok: false, errorCode: 'conversation_lookup_failed' };
    }
    if (!conversation) {
      return { ok: false, errorCode: 'conversation_not_found' };
    }
    if (conversation.org_id !== orgId) {
      console.error('[schedule-draft] org_mismatch', {
        conversationId,
        expectedOrg: orgId,
        actualOrg: conversation.org_id,
      });
      return { ok: false, errorCode: 'org_mismatch' };
    }

    const channel = (conversation.channel ?? 'email') as AgentChannel;
    // Only the channels this helper is designed for. Web-chat lives in
    // /api/ai-chat (streaming); voice has its own pipeline. Guard
    // defensively so a misuse surfaces as an errorCode rather than a
    // confusing prompt mismatch.
    if (channel !== 'email' && channel !== 'whatsapp') {
      return { ok: false, errorCode: 'unsupported_channel' };
    }

    const buyerLocale = (conversation.buyer_locale ?? 'en') as Locale;
    const propertyId = (conversation.property_id ?? undefined) as
      | string
      | undefined;

    // ─── 2. Load the agent + org via membership ──────────────────────
    const { data: agent, error: agentErr } = await supabase
      .from('profiles')
      .select('id, full_name, languages_spoken, specialties, bio')
      .eq('id', agentId)
      .maybeSingle();
    if (agentErr) {
      console.error('[schedule-draft] agent_lookup_error', {
        code: agentErr.code,
        message: agentErr.message,
        agentId,
      });
      return { ok: false, errorCode: 'agent_lookup_failed' };
    }
    if (!agent) {
      return { ok: false, errorCode: 'agent_not_found' };
    }

    const { data: orgRow, error: orgErr } = await supabase
      .from('organizations')
      .select('id, name, slug, headquarters_country')
      .eq('id', orgId)
      .maybeSingle();
    if (orgErr) {
      console.error('[schedule-draft] org_lookup_error', {
        code: orgErr.code,
        message: orgErr.message,
        orgId,
      });
      return { ok: false, errorCode: 'org_lookup_failed' };
    }
    if (!orgRow) {
      return { ok: false, errorCode: 'org_not_found' };
    }
    // Fixture orgs never serve a live AI session — same posture as
    // /api/ai-chat. CLAUDE.md R11.
    if (typeof orgRow.slug === 'string' && orgRow.slug.startsWith('aho-test-org-')) {
      return { ok: false, errorCode: 'fixture_org' };
    }

    // ─── 3. Billing tier → AI gating tier ────────────────────────────
    const agentPlanId = await getOrgPlanId(supabase, orgId);
    const tier = mapBillingTierToAgentTier(planTierLabel(agentPlanId));

    // ─── 4. Resolve market from org's headquarters_country ───────────
    const market = countryToMarket(orgRow.headquarters_country);

    // ─── 5. Knowledge context ────────────────────────────────────────
    const knowledge = await fetchKnowledge({
      supabase,
      agentId,
      focusListingId: propertyId,
      buyerLocale,
    });

    // ─── 6. System prompt (channel comes from the conversation) ──────
    const focusListingTitle = propertyId
      ? knowledge.listings.find((l) => l.id === propertyId)?.title
      : undefined;

    const systemPrompt = buildAgentSystemPrompt({
      agent: {
        name: knowledge.agent.name || agent.full_name || 'the agent',
        languages: knowledge.agent.languages,
        specialties: knowledge.agent.specialties,
        bio: knowledge.agent.bio,
      },
      org: { name: knowledge.org.name || orgRow.name },
      market,
      buyerLocale,
      channel,
      tier,
      focusListingTitle,
      listingCount: knowledge.listings.length,
    });

    // Knowledge payload appended as a user-role frame the orchestrator
    // routes into the assistant's context. Mirrors /api/ai-chat —
    // converse() doesn't accept multi-block system inputs, so we
    // splice the knowledge into the conversation history.
    const knowledgeBlock = `<knowledge>\n${JSON.stringify(knowledge, null, 2)}\n</knowledge>`;

    // ─── 7. Load prior N turns (asc) ─────────────────────────────────
    const { data: priorRowsDesc, error: priorErr } = await supabase
      .from('ai_conversation_messages')
      .select('role, body, created_at')
      .eq('conversation_id', conversationId)
      .in('role', ['user', 'assistant'])
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURN_LIMIT);
    if (priorErr) {
      console.error('[schedule-draft] prior_messages_error', {
        code: priorErr.code,
        message: priorErr.message,
        conversationId,
      });
      return { ok: false, errorCode: 'prior_messages_failed' };
    }
    const prior = ((priorRowsDesc ?? []) as Array<{ role: string; body: string; created_at: string }>)
      .slice()
      .reverse();

    // ─── 8. Find the latest USER turn — what we're drafting toward ───
    let latestUserMessage: string | null = null;
    for (let i = prior.length - 1; i >= 0; i--) {
      const row = prior[i];
      if (row && row.role === 'user') {
        latestUserMessage = row.body ?? '';
        break;
      }
    }
    if (latestUserMessage === null) {
      return { ok: false, errorCode: 'no_user_turn' };
    }

    // Build the ConverseMessage[] for the orchestrator. The latest
    // user turn is already in `prior`, so we don't append it again.
    const messages: ConverseMessage[] = [];
    messages.push({ role: 'user', content: knowledgeBlock });
    messages.push({ role: 'assistant', content: '(context received)' });
    for (const row of prior) {
      if (row.role !== 'user' && row.role !== 'assistant') continue;
      messages.push({
        role: row.role as 'user' | 'assistant',
        content: row.body ?? '',
      });
    }

    // ─── 9. Call converse() — NOT converseStream (no SSE needed) ─────
    const out = await converse({
      systemPrompt,
      messages,
      supabase,
      agentId,
      orgId,
      conversationId,
      // We don't have a row id yet (we insert the assistant row AFTER
      // we know the text). converse() only uses this for log/audit
      // attribution, so pass the conversationId as a stand-in. The
      // ai_generation_log row is keyed on (conversationId, purpose,
      // model) for analytics; the messageId is informational only.
      conversationMessageId: conversationId,
      market,
      preferFast: false, // Sonnet for high-quality email/WhatsApp drafts
      purpose: 'ai_agent_converse',
    });

    if (out.errorCode) {
      console.error('[schedule-draft] converse_error', {
        errorCode: out.errorCode,
        conversationId,
      });
      return { ok: false, errorCode: out.errorCode };
    }
    if (!out.text || out.text.trim().length === 0) {
      return { ok: false, errorCode: 'empty_draft' };
    }

    // ─── 10. Classify the draft. autoSendPolicyEnabled=false → HITL ──
    const classification = classifyAssistantTurn({
      userMessage: latestUserMessage,
      assistantDraft: out.text,
      tier,
      autoSendPolicyEnabled: false,
    });
    // Schema enum is 'pending' | 'auto_sent' (plus rejected/sent set by
    // the agent in /dashboard/ai-inbox). With autoSendPolicyEnabled=
    // false, the gate returns 'pending' for non-escalate paths and
    // 'escalate' for human-handoff requests; we land both as 'pending'
    // (the conversation status flip to 'escalated' is owned by the
    // escalate_to_human tool inside converse).
    const approvalStatus: 'pending' | 'auto_sent' =
      classification.approvalStatus === 'auto_send' ? 'auto_sent' : 'pending';

    // ─── 11. INSERT the assistant message row ────────────────────────
    const { data: inserted, error: insertErr } = await supabase
      .from('ai_conversation_messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        channel,
        body: out.text,
        confidence: classification.confidence,
        intent: classification.intent,
        risk_flags: classification.riskFlags,
        approval_status: approvalStatus,
        ...(approvalStatus === 'auto_sent'
          ? { sent_at: new Date().toISOString() }
          : {}),
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      console.error('[schedule-draft] assistant_insert_error', {
        code: insertErr?.code,
        message: insertErr?.message,
        details: insertErr?.details,
        hint: insertErr?.hint,
        conversationId,
      });
      return { ok: false, errorCode: 'assistant_persist_failed' };
    }

    // ─── 12. Bump last_message_at so the inbox sort is correct ───────
    const { error: bumpErr } = await supabase
      .from('ai_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (bumpErr) {
      console.error('[schedule-draft] conv_bump_error', {
        code: bumpErr.code,
        message: bumpErr.message,
        conversationId,
      });
      // Non-fatal — the message landed; only the inbox sort order
      // for this conversation is stale until the next message.
    }

    return { ok: true, messageId: inserted.id as string };
  } catch (err) {
    // Fire-and-forget grade: never throw. Caller catches errorCode +
    // logs but otherwise still returns 200 to the upstream Worker so
    // we don't trigger Meta/Cloudflare retry storms on our own bugs.
    console.error('[schedule-draft] unexpected_throw', {
      conversationId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, errorCode: 'unexpected_error' };
  }
}
