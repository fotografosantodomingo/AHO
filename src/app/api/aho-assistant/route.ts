import { type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  buildAhoAssistantSystemPrompt,
  type AhoAssistantChannel,
  type AhoAssistantPromptInput,
} from '@/lib/ai/aho-assistant-prompt';
import { converseStream, type ConverseMessage } from '@/lib/ai/converse';
import type { Locale } from '@/i18n/config';

export const runtime = 'edge';

/**
 * POST /api/aho-assistant
 *
 * The AHO platform assistant — cousin of `/api/ai-chat` but anchored
 * to the AHO platform itself rather than a specific agent. Mounted on
 * /, /pricing, /for-agents, /automation, /save-time, /docs, dashboard
 * layout. Answers "what is AHO?", "what does Pro Automation include?",
 * "how do I connect Instagram?", "what's your privacy policy?" etc.
 *
 * v1 = STATELESS:
 *   - No `ai_conversations` row is persisted (the conversation history
 *     lives in the client's local state + the request payload's
 *     `priorMessages` array, capped at 20 entries).
 *   - No HITL gating: the AHO Assistant is platform-side, not per-
 *     agent, so there's no human "agent" to approve. The reply
 *     streams directly to the user.
 *   - No tool execution: the AHO Assistant doesn't book viewings or
 *     look up listings; those are the per-agent AI's job. The
 *     orchestrator is called with `supabase: undefined` so any tool
 *     call returns a stubbed-error result (the model rarely tries).
 *
 * Streaming events match `/api/ai-chat`'s shape (text-delta + done)
 * so the widget can share the SSE parser between the two surfaces.
 *
 * Why no persistence: every visitor on the homepage / pricing page
 * would otherwise create an `ai_conversations` row; that's 100x the
 * volume of per-agent chat. The conversation isn't valuable enough
 * to persist (it's platform Q&A, not lead-bearing buyer contact).
 * If we later want to attribute "this conversation became a signup",
 * we'd add a lead-capture-on-intent step similar to the per-agent
 * widget's 3-turns-then-capture flow.
 */

const SURFACE_VALUES = [
  'home',
  'pricing',
  'for-agents',
  'automation',
  'save-time',
  'docs',
  'dashboard',
  'other',
] as const;

const BodySchema = z.object({
  userLocale: z.enum(['en', 'es', 'pl', 'pt', 'de', 'fr', 'it']),
  channel: z.enum(['web_chat', 'email']).default('web_chat'),
  isAuthenticated: z.boolean().default(false),
  surfaceContext: z.enum(SURFACE_VALUES).optional(),
  userMessage: z.string().trim().min(1).max(2000),
  /** Optional rolling conversation history, max 20 prior turns.
   *  Client-managed; we don't trust order — we just splice it in. */
  priorMessages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .max(20)
    .default([]),
});

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

  // Build the system prompt. The KB is embedded in there; we don't
  // need any DB lookup for this endpoint.
  const promptInput: AhoAssistantPromptInput = {
    userLocale: body.userLocale as Locale,
    channel: body.channel as AhoAssistantChannel,
    isAuthenticated: body.isAuthenticated,
    surfaceContext: body.surfaceContext,
  };
  const systemPrompt = buildAhoAssistantSystemPrompt(promptInput);

  // Build the messages array: prior turns (already-validated shape)
  // + the new user turn. Cap to 20 prior for input-budget safety.
  const messages: ConverseMessage[] = [
    ...body.priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: body.userMessage },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (evt: SseEvent) => {
        controller.enqueue(encoder.encode(formatSse(evt)));
      };

      // The conversation/message IDs in the orchestrator are required
      // input fields but only used downstream for logAiCall + tool
      // bookkeeping. Since this endpoint is stateless, we synthesize
      // disposable placeholder IDs. logAiCall still writes a row to
      // ai_generation_log so cost tracking continues to work for the
      // AHO Assistant traffic.
      const placeholderConversationId = '00000000-0000-0000-0000-000000000000';
      const placeholderMessageId = '00000000-0000-0000-0000-000000000000';

      const iterator = converseStream({
        systemPrompt,
        messages,
        // No supabase client → tools return stubbed errors. The AHO
        // Assistant doesn't need to call any tools (no DB lookups
        // for platform Q&A) but the orchestrator accepts the param.
        agentId: 'aho-assistant',
        orgId: 'aho-platform',
        conversationId: placeholderConversationId,
        conversationMessageId: placeholderMessageId,
        purpose: 'ai_agent_converse',
        // Prefer Haiku for the AHO Assistant — most platform Q&A
        // turns are short ("what does Pro Automation include?") +
        // bounded by the KB, so the cheaper model is plenty.
        preferFast: true,
        maxTokens: 800,
      });

      try {
        let finalText = '';
        for await (const evt of iterator) {
          if (evt.kind === 'text-delta') {
            finalText += evt.delta;
            send({ event: 'text-delta', data: { delta: evt.delta } });
          } else if (evt.kind === 'tool-call') {
            // The AHO Assistant doesn't expose tools to the user. If
            // the model tries to invoke one anyway, we emit an event
            // for observability but the orchestrator's dry-run
            // tool-execution path returns a stubbed error and the
            // model will commit to a text reply on the next loop.
            send({
              event: 'tool-call',
              data: { id: evt.toolCall.id, name: evt.toolCall.name },
            });
          } else if (evt.kind === 'done') {
            send({
              event: 'done',
              data: {
                ok: true,
                finalText,
                usage: evt.output.usage,
                model: evt.output.model,
                latencyMs: evt.output.latencyMs,
                errorCode: evt.output.errorCode,
              },
            });
          }
        }
      } catch (err) {
        console.error('[aho-assistant] stream error', err);
        send({
          event: 'done',
          data: {
            ok: false,
            errorCode: 'stream_failed',
            detail: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
