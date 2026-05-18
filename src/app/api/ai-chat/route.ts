import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchKnowledge } from '@/lib/ai/knowledge';
import {
  buildAgentSystemPrompt,
  type AgentMarket,
} from '@/lib/ai/agent-prompts';
import { converseStream, type ConverseMessage } from '@/lib/ai/converse';
import { classifyAssistantTurn } from '@/lib/ai/gating';
import { getOrgPlanId, planTierLabel } from '@/lib/billing/plan-gating';
import { mapBillingTierToAgentTier } from '@/lib/ai/agent-tier';
import type { Locale } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/ai-chat
 *
 * Phase 2 — web-chat surface for the AHO AI customer-service agent.
 * Streams the assistant response as Server-Sent Events while persisting
 * the full conversation to `ai_conversations` + `ai_conversation_messages`.
 *
 * Flow per turn:
 *   1. Resolve agent + org (service-role; agent_id from request body).
 *   2. Reject when the org is a fixture (`aho-test-org-%`).
 *   3. Create-or-load conversation row (verifies org match).
 *   4. Persist the buyer's user turn.
 *   5. Build the system prompt via buildAgentSystemPrompt.
 *   6. Fetch knowledge + format as a SYSTEM-role appendix.
 *   7. Replay the last 30 turns + current user turn into converseStream.
 *   8. Stream `event: text-delta` / `event: tool-call` / `event: done`
 *      to the client.
 *   9. Classify final text via classifyAssistantTurn — per D2=A,
 *      autoSendPolicyEnabled=false so it lands as `pending` (HITL).
 *  10. Persist the assistant row + bump conversations.last_message_at.
 *
 * Edge runtime: every supabase write is `await`ed (per CLAUDE.md gotcha
 * — Edge cancels unawaited promises) and `{ error }` is destructured on
 * every call (supabase-js does not throw on row-level errors).
 */

const BodySchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  agentId: z.string().uuid(),
  propertyId: z.string().uuid().optional(),
  buyerLocale: z.enum(['en', 'es', 'pl', 'pt', 'de', 'fr', 'it']),
  userMessage: z.string().trim().min(1).max(2000),
  sessionToken: z.string().max(128).optional(),
});

// Map an ISO country code (org headquarters) to the AgentMarket bucket
// the system prompt understands. Anything we don't recognize falls back
// to 'us' (English / pragmatic copy). Mirrors the locale → market
// heuristics in src/lib/social/market-prompts.ts.
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

interface SseEvent {
  event: string;
  data: unknown;
}

function formatSse({ event, data }: SseEvent): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function jsonError(status: number, error: string, hint?: string): Response {
  return new Response(JSON.stringify({ error, ...(hint ? { hint } : {}) }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return jsonError(400, 'invalid_request', err instanceof Error ? err.message : 'bad_body');
  }

  const admin = createAdminClient();

  // ─── Step 1+2: resolve agent + org, fixture guard ───────────────────
  const { data: agent, error: agentErr } = await admin
    .from('profiles')
    .select('id, full_name, languages_spoken, specialties, bio')
    .eq('id', body.agentId)
    .maybeSingle();
  if (agentErr) {
    console.error('[ai-chat] profile lookup error', {
      code: agentErr.code,
      message: agentErr.message,
      agentId: body.agentId,
    });
    return jsonError(500, 'agent_lookup_failed');
  }
  if (!agent) {
    return jsonError(404, 'agent_not_found');
  }

  const { data: membership, error: membershipErr } = await admin
    .from('organization_members')
    .select('org_id, organizations!inner(id, name, slug, headquarters_country)')
    .eq('user_id', body.agentId)
    .limit(1)
    .maybeSingle();
  if (membershipErr) {
    console.error('[ai-chat] membership lookup error', {
      code: membershipErr.code,
      message: membershipErr.message,
      agentId: body.agentId,
    });
    return jsonError(500, 'org_lookup_failed');
  }
  if (!membership) {
    return jsonError(404, 'agent_not_found');
  }

  // supabase-js sometimes returns the embedded relation as a single
  // object, sometimes as a one-element array depending on the
  // PostgREST schema cache — defend against both.
  const rawOrg = (membership as { organizations: unknown }).organizations;
  const org = (Array.isArray(rawOrg) ? rawOrg[0] : rawOrg) as
    | { id: string; name: string; slug: string; headquarters_country: string | null }
    | null;
  if (!org) {
    return jsonError(404, 'agent_not_found');
  }

  // Fixture orgs never serve a live AI session — same posture as the
  // public sitemap, /agents/[slug] and the by-bbox API. CLAUDE.md R11.
  if (org.slug.startsWith('aho-test-org-')) {
    return jsonError(404, 'agent_not_found');
  }

  // ─── Step 3: create-or-load conversation ───────────────────────────
  let conversationId = body.conversationId ?? null;
  if (conversationId) {
    const { data: existing, error: convErr } = await admin
      .from('ai_conversations')
      .select('id, org_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) {
      console.error('[ai-chat] conversation lookup error', {
        code: convErr.code,
        message: convErr.message,
        conversationId,
      });
      return jsonError(500, 'conversation_lookup_failed');
    }
    if (!existing || existing.org_id !== org.id) {
      // Either the caller fabricated an id or it belongs to another
      // org; treat as not-found to avoid leaking org boundaries.
      return jsonError(404, 'conversation_not_found');
    }
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from('ai_conversations')
      .insert({
        org_id: org.id,
        agent_id: body.agentId,
        property_id: body.propertyId ?? null,
        channel: 'web_chat',
        status: 'open',
        buyer_locale: body.buyerLocale,
        buyer_session_token: body.sessionToken ?? null,
      })
      .select('id')
      .single();
    if (insertErr || !inserted) {
      console.error('[ai-chat] conversation insert error', {
        code: insertErr?.code,
        message: insertErr?.message,
        details: insertErr?.details,
      });
      return jsonError(500, 'conversation_create_failed');
    }
    conversationId = inserted.id;
  }

  // ─── Step 4: persist the buyer's user turn ─────────────────────────
  const { error: userMsgErr } = await admin
    .from('ai_conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      channel: 'web_chat',
      body: body.userMessage,
    });
  if (userMsgErr) {
    console.error('[ai-chat] user message insert error', {
      code: userMsgErr.code,
      message: userMsgErr.message,
      details: userMsgErr.details,
    });
    return jsonError(500, 'user_message_persist_failed');
  }

  // ─── Step 5+6: system prompt + knowledge ───────────────────────────
  const market = countryToMarket(org.headquarters_country);
  const knowledge = await fetchKnowledge({
    supabase: admin,
    agentId: body.agentId,
    focusListingId: body.propertyId,
    buyerLocale: body.buyerLocale as Locale,
  });

  // Resolve the AGENT's billing tier (not the buyer's — buyers are
  // anonymous on this surface). Per D5=A, AI inbox is bundled into
  // Pro Automation; agents on lower tiers get HITL-only gating.
  // Defaults gracefully to 'free' on lookup failure so the widget
  // never breaks the page on a billing-table miss.
  const agentPlanId = await getOrgPlanId(admin, org.id);
  const tier = mapBillingTierToAgentTier(planTierLabel(agentPlanId));

  // Find the focus-listing title for the system prompt's optional
  // FOCUS LISTING block. fetchKnowledge has already sorted the focus
  // listing first.
  const focusListingTitle = body.propertyId
    ? knowledge.listings.find((l) => l.id === body.propertyId)?.title
    : undefined;

  const systemPrompt = buildAgentSystemPrompt({
    agent: {
      name: knowledge.agent.name || agent.full_name || 'the agent',
      languages: knowledge.agent.languages,
      specialties: knowledge.agent.specialties,
      bio: knowledge.agent.bio,
    },
    org: { name: knowledge.org.name || org.name },
    market,
    buyerLocale: body.buyerLocale as Locale,
    channel: 'web_chat',
    tier,
    focusListingTitle,
    listingCount: knowledge.listings.length,
  });

  // Knowledge payload appended as a SYSTEM-role message so the model
  // treats it as ground-truth context rather than a buyer message.
  const knowledgeBlock = `<knowledge>\n${JSON.stringify(knowledge, null, 2)}\n</knowledge>`;

  // ─── Step 7: load prior turns (max 30) + append current user turn ─
  const { data: priorRows, error: priorErr } = await admin
    .from('ai_conversation_messages')
    .select('role, body, tool_call, tool_result, created_at')
    .eq('conversation_id', conversationId)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(30);
  if (priorErr) {
    console.error('[ai-chat] prior messages lookup error', {
      code: priorErr.code,
      message: priorErr.message,
    });
  }
  const prior = (priorRows ?? []).reverse();

  // Build the ConverseMessage[] for the orchestrator. The user turn we
  // just inserted is already in `prior` (it's the most recent row), so
  // we don't append it again here.
  const messages: ConverseMessage[] = [];
  // Prepend the knowledge block as a leading user-role message that
  // the orchestrator's wire-format builder will route into the
  // assistant's context. The system field in Anthropic doesn't accept
  // multiple blocks via converse(), so we splice it in as the first
  // user-role frame and rely on the buyer messages that follow to
  // override topic.
  messages.push({ role: 'user', content: knowledgeBlock });
  // We need an assistant ack so the next user turn is well-formed.
  messages.push({ role: 'assistant', content: '(context received)' });
  for (const row of prior) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    messages.push({ role: row.role, content: row.body });
  }

  // ─── Step 8: insert a placeholder assistant row we'll fill below ──
  const { data: assistantRow, error: assistantInsertErr } = await admin
    .from('ai_conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      channel: 'web_chat',
      body: '',
      approval_status: 'pending',
    })
    .select('id')
    .single();
  if (assistantInsertErr || !assistantRow) {
    console.error('[ai-chat] assistant placeholder insert error', {
      code: assistantInsertErr?.code,
      message: assistantInsertErr?.message,
    });
    return jsonError(500, 'assistant_persist_failed');
  }
  const assistantMessageId = assistantRow.id;

  // ─── Step 9: SSE stream ─────────────────────────────────────────────
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (e: SseEvent) => controller.enqueue(encoder.encode(formatSse(e)));

      try {
        let finalText = '';
        let approvalStatus: 'pending' | 'auto_sent' = 'pending';

        // First yield event with the conversation id so the client can
        // persist it to localStorage even if the stream errors mid-way.
        send({ event: 'conversation', data: { conversationId, messageId: assistantMessageId } });

        const iterator = converseStream({
          systemPrompt,
          messages,
          supabase: admin,
          agentId: body.agentId,
          orgId: org.id,
          conversationId: conversationId!,
          conversationMessageId: assistantMessageId,
          market,
        });

        for await (const evt of iterator) {
          if (evt.kind === 'text-delta') {
            finalText += evt.delta;
            send({ event: 'text-delta', data: { delta: evt.delta } });
          } else if (evt.kind === 'tool-call') {
            send({
              event: 'tool-call',
              data: {
                id: evt.toolCall.id,
                name: evt.toolCall.name,
                input: evt.toolCall.input,
              },
            });
          } else if (evt.kind === 'done') {
            // Step 10: classify + update the placeholder row.
            const classification = classifyAssistantTurn({
              userMessage: body.userMessage,
              assistantDraft: finalText,
              tier,
              // Per D2=A: every channel is HITL in v1. When PO flips
              // to D2=B (confidence-gated auto-send), this becomes
              // true and the gate's confidence + risk-flag logic
              // takes over.
              autoSendPolicyEnabled: false,
            });
            // approvalStatus from the gate is 'auto_send' | 'pending'
            // | 'escalate'; we only ever write the DB enum values:
            //   - pending      → HITL (buyer sees badge, agent reviews)
            //   - auto_sent    → gate let it through
            //   For 'escalate' the conversation status flips to
            //   'escalated' via the escalate_to_human tool, but the
            //   message itself still lands as `pending`.
            approvalStatus =
              classification.approvalStatus === 'auto_send' ? 'auto_sent' : 'pending';

            const { error: updateErr } = await admin
              .from('ai_conversation_messages')
              .update({
                body: finalText,
                confidence: classification.confidence,
                intent: classification.intent,
                risk_flags: classification.riskFlags,
                approval_status: approvalStatus,
                ...(approvalStatus === 'auto_sent'
                  ? { sent_at: new Date().toISOString() }
                  : {}),
              })
              .eq('id', assistantMessageId);
            if (updateErr) {
              console.error('[ai-chat] assistant row update error', {
                code: updateErr.code,
                message: updateErr.message,
                details: updateErr.details,
              });
            }

            // Bump last_message_at on the conversation so dashboard
            // inbox sorts correctly.
            const { error: bumpErr } = await admin
              .from('ai_conversations')
              .update({ last_message_at: new Date().toISOString() })
              .eq('id', conversationId!);
            if (bumpErr) {
              console.error('[ai-chat] conversation bump error', {
                code: bumpErr.code,
                message: bumpErr.message,
              });
            }

            send({
              event: 'done',
              data: {
                conversationId,
                messageId: assistantMessageId,
                approvalStatus,
                intent: classification.intent,
                riskFlags: classification.riskFlags,
              },
            });
          }
        }
      } catch (err) {
        console.error('[ai-chat] stream error', err);
        send({ event: 'error', data: { error: 'stream_failed' } });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
