import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAiCall } from '@/lib/ai/log';

/**
 * Claude orchestrator for the AHO AI customer-service agent.
 *
 * THE only place that talks to the Anthropic Messages API for
 * conversation turns. Channel adapters (web chat / email / WhatsApp /
 * voice) call into this module; this module wraps the raw fetch call
 * to https://api.anthropic.com/v1/messages with:
 *
 *   - Token-streaming for SSE-friendly web chat (converseStream)
 *   - Tool-use schema (5 tools: lookup_listing, find_comparable,
 *     get_agent_availability, book_viewing, escalate_to_human)
 *   - Tool-call loop with hard cap (3 iterations) to prevent runaway
 *     tool-loop cost — on the 3rd loop tool_choice is forced to 'none'
 *     so the model commits to a text reply
 *   - Per-call logging via the existing logAiCall (writes
 *     ai_generation_log with model + market + latency + tokens + cost)
 *   - Edge-runtime safe: uses globalThis.fetch + the raw Messages API
 *     (matching the pattern in src/lib/listings/import-from-url.ts and
 *     src/lib/social/ai-drafter.ts; the @anthropic-ai/sdk package is
 *     intentionally NOT used to keep the worker bundle lean)
 *
 * CLAUDE.md gotcha discipline:
 *   - Every logAiCall is awaited (Edge runtime kills unawaited
 *     promises when the request handler returns)
 *   - Errors are NEVER thrown past the function boundary; on failure
 *     the function returns a sensible empty-state output + writes an
 *     error row to ai_generation_log. Caller decides whether to retry
 */

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Sonnet — default model for substantive replies (long-form, tool-use). */
const MODEL_SONNET = 'claude-sonnet-4-6';
/** Haiku — used when caller passes preferFast=true. ~10× cheaper. */
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

/** Max tool-call loops before forcing a text reply. Per AI_AGENT_PLAN
 *  §5.6 cost containment. */
const MAX_TOOL_LOOPS = 3;

/** Default output cap. Channel adapters can override via maxTokens. */
const DEFAULT_MAX_TOKENS = 1500;

/* ─── Tool catalog ────────────────────────────────────────────────── */

export type ToolName =
  | 'lookup_listing'
  | 'find_comparable'
  | 'get_agent_availability'
  | 'book_viewing'
  | 'escalate_to_human';

/**
 * JSON-Schema definitions for the 5 tools the AI agent can call.
 * Each one is passed to Anthropic as a tool block in the `tools`
 * request param. The model emits `tool_use` blocks; this module
 * executes the tool and feeds back a `tool_result` block.
 */
export const TOOL_SCHEMAS = [
  {
    name: 'lookup_listing' as const,
    description:
      "Pull full details for one of this agent's AHO listings by its short_id (6-character code). Use this when the buyer asks about a specific listing and you don't already have its facts in context.",
    input_schema: {
      type: 'object' as const,
      properties: {
        short_id: {
          type: 'string' as const,
          description: 'The 6-character listing short_id (e.g. "3xk9wz").',
        },
      },
      required: ['short_id'],
    },
  },
  {
    name: 'find_comparable' as const,
    description:
      "Find up to N similar properties on AHO for context (same property_type, same city, similar size). Use this when the buyer asks how a price compares or wants alternatives.",
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: {
          type: 'string' as const,
          description: 'UUID of the reference listing.',
        },
        max_results: {
          type: 'integer' as const,
          description: 'Maximum number of comparables to return (default 5, hard cap 10).',
          minimum: 1,
          maximum: 10,
        },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'get_agent_availability' as const,
    description:
      "Look up when this agent is available to show a property in a given date range. Returns up to 5 candidate slots.",
    input_schema: {
      type: 'object' as const,
      properties: {
        date_range_start: {
          type: 'string' as const,
          description: 'ISO 8601 date (e.g. "2026-05-20"). Inclusive.',
        },
        date_range_end: {
          type: 'string' as const,
          description: 'ISO 8601 date. Inclusive. Must be within 14 days of start.',
        },
      },
      required: ['date_range_start', 'date_range_end'],
    },
  },
  {
    name: 'book_viewing' as const,
    description:
      "Reserve a viewing slot for a buyer. Writes a lead row that the agent reviews. Use this only after the buyer has explicitly confirmed a specific time AND given their name + contact.",
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: {
          type: 'string' as const,
          description: 'UUID of the listing to view.',
        },
        buyer_name: {
          type: 'string' as const,
          description: "Buyer's full name as they gave it.",
        },
        buyer_contact: {
          type: 'string' as const,
          description: "Phone (E.164) or email — whichever the buyer offered.",
        },
        requested_time: {
          type: 'string' as const,
          description: 'ISO 8601 datetime in the listing market timezone.',
        },
      },
      required: ['listing_id', 'buyer_name', 'buyer_contact', 'requested_time'],
    },
  },
  {
    name: 'escalate_to_human' as const,
    description:
      "Flag the conversation for human handoff. Use this when the buyer asks for the human agent, when the question is outside your scope (legal, financial, price negotiation, commission), or when you've tried 3+ times to answer and the buyer still seems unsatisfied.",
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string' as const,
          description: 'One-line reason for escalation; surfaced to the agent.',
        },
      },
      required: ['reason'],
    },
  },
];

/* ─── Public types ────────────────────────────────────────────────── */

export type ConverseRole = 'user' | 'assistant' | 'tool';

export interface ConverseMessage {
  role: ConverseRole;
  content: string;
  /** Required for role='tool' rows — the id the assistant gave in
   *  its preceding tool_use block. */
  toolCallId?: string;
}

export interface ConverseInput {
  /** System prompt from buildAgentSystemPrompt. */
  systemPrompt: string;
  /** Prior conversation in order; the model continues from here. */
  messages: ConverseMessage[];
  /** When true, model = Haiku 4.5 (cheap, fast). Default = Sonnet. */
  preferFast?: boolean;
  /** Hard cap on output tokens. Default 1500. */
  maxTokens?: number;
  /** When omitted, tool calls return a stubbed error instead of
   *  executing — useful for tests and dry-runs. */
  supabase?: SupabaseClient;
  /** Caller scope: which agent this conversation belongs to. */
  agentId: string;
  /** Caller scope: org for RLS-fence on tool execution. */
  orgId: string;
  /** For ai_generation_log + audit attribution. */
  conversationId: string;
  /** The assistant-turn message row we're filling. */
  conversationMessageId: string;
  /** Override the default 'ai_agent_converse' purpose value. */
  purpose?: 'ai_agent_converse' | 'ai_agent_classify';
  /** Market dimension for cost/usage rollups in the admin dashboard. */
  market?: 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';
}

export interface ConverseToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ConverseToolResult {
  id: string;
  output: unknown;
  isError?: boolean;
}

export type FinishReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'stop_sequence'
  | 'unknown';

export interface ConverseOutput {
  /** The assistant's drafted reply text (after any tool-loop). */
  text: string;
  /** Tool calls the model emitted (informational; already executed). */
  toolCalls: ConverseToolCall[];
  /** Tool results that flowed back into the model. */
  toolResults: ConverseToolResult[];
  finishReason: FinishReason;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  model: string;
  /** Set when the call failed; text + tool arrays will be empty. */
  errorCode?: string;
}

/* ─── Anthropic wire-format types ─────────────────────────────────── */

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason?: string;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicRequestMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      >;
}

/* ─── Public API ──────────────────────────────────────────────────── */

/**
 * Run one full conversation turn — including any tool-call loop —
 * and return the final assistant text. Always logs to
 * ai_generation_log. Never throws.
 */
export async function converse(input: ConverseInput): Promise<ConverseOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = input.preferFast ? MODEL_HAIKU : MODEL_SONNET;
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;
  const purpose = input.purpose ?? 'ai_agent_converse';
  const startedAt = Date.now();

  if (!apiKey) {
    const latencyMs = Date.now() - startedAt;
    await logAiCall({
      purpose,
      model,
      market: input.market ?? null,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      errorCode: 'anthropic_key_missing',
    });
    return {
      text: '',
      toolCalls: [],
      toolResults: [],
      finishReason: 'unknown',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs,
      model,
      errorCode: 'anthropic_key_missing',
    };
  }

  // Convert the caller's flat ConverseMessage[] into Anthropic's
  // structured-content shape. tool rows become tool_result blocks
  // attached to a user-role message (the wire-format convention).
  const apiMessages: AnthropicRequestMessage[] = [];
  for (const m of input.messages) {
    if (m.role === 'tool') {
      if (!m.toolCallId) {
        // Defensive: shouldn't happen if the caller is well-formed
        // (this module is the only producer of toolCallIds), but
        // dropping the row is safer than a 400 from Anthropic.
        continue;
      }
      apiMessages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId,
            content: m.content,
          },
        ],
      });
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  const allToolCalls: ConverseToolCall[] = [];
  const allToolResults: ConverseToolResult[] = [];
  let aggregateInputTokens = 0;
  let aggregateOutputTokens = 0;
  let finalText = '';
  let finalFinishReason: FinishReason = 'unknown';

  // Tool-call loop. Each iteration is one round-trip to Anthropic.
  // Hard cap at MAX_TOOL_LOOPS (3) — on the final iteration we force
  // tool_choice='none' so the model commits to a text reply rather
  // than emitting yet another tool_use.
  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const isLastLoop = loop === MAX_TOOL_LOOPS - 1;
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: input.systemPrompt,
      messages: apiMessages,
      tools: TOOL_SCHEMAS,
    };
    if (isLastLoop) {
      // Forced text-only commit on the final attempt.
      body.tool_choice = { type: 'none' };
    }

    let apiRes: Response;
    try {
      apiRes = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      await logAiCall({
        purpose,
        model,
        market: input.market ?? null,
        inputTokens: aggregateInputTokens,
        outputTokens: aggregateOutputTokens,
        latencyMs,
        errorCode: 'anthropic_network',
      });
      console.error('[converse] anthropic network error', err);
      return {
        text: '',
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        finishReason: 'unknown',
        usage: { inputTokens: aggregateInputTokens, outputTokens: aggregateOutputTokens },
        latencyMs,
        model,
        errorCode: 'anthropic_network',
      };
    }

    if (!apiRes.ok) {
      const latencyMs = Date.now() - startedAt;
      const errorCode =
        apiRes.status === 429
          ? 'anthropic_429'
          : apiRes.status >= 500
            ? `anthropic_${apiRes.status}`
            : `anthropic_${apiRes.status}`;
      await logAiCall({
        purpose,
        model,
        market: input.market ?? null,
        inputTokens: aggregateInputTokens,
        outputTokens: aggregateOutputTokens,
        latencyMs,
        errorCode,
      });
      try {
        const detail = await apiRes.text();
        console.error('[converse] anthropic non-2xx', {
          status: apiRes.status,
          detail: detail.slice(0, 400),
        });
      } catch {
        // ignore
      }
      return {
        text: '',
        toolCalls: allToolCalls,
        toolResults: allToolResults,
        finishReason: 'unknown',
        usage: { inputTokens: aggregateInputTokens, outputTokens: aggregateOutputTokens },
        latencyMs,
        model,
        errorCode,
      };
    }

    const response = (await apiRes.json()) as AnthropicResponse;
    aggregateInputTokens += response.usage.input_tokens;
    aggregateOutputTokens += response.usage.output_tokens;
    finalFinishReason = normalizeFinishReason(response.stop_reason);

    // Pull out tool_use blocks (if any) and the text body.
    const toolUseBlocks = response.content.filter(
      (b): b is Extract<AnthropicContentBlock, { type: 'tool_use' }> =>
        b.type === 'tool_use',
    );
    const textBlocks = response.content.filter(
      (b): b is Extract<AnthropicContentBlock, { type: 'text' }> => b.type === 'text',
    );
    const text = textBlocks.map((b) => b.text).join('');

    // No tool calls → we're done. Return the text reply.
    if (toolUseBlocks.length === 0) {
      finalText = text;
      break;
    }

    // Record the tool calls + append the assistant message to apiMessages
    // (Anthropic protocol: include the assistant's tool_use blocks back
    // in the next request so the model has its own context).
    apiMessages.push({
      role: 'assistant',
      content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...toolUseBlocks.map((b) => ({
          type: 'tool_use' as const,
          id: b.id,
          name: b.name,
          input: b.input,
        })),
      ],
    });

    // Execute each tool call serially. Edge runtime can do this
    // efficiently; the tools are mostly Supabase RLS-scoped lookups
    // (~20-80 ms each).
    const newToolResults: Array<{
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }> = [];
    for (const tu of toolUseBlocks) {
      const toolCall: ConverseToolCall = {
        id: tu.id,
        name: tu.name as ToolName,
        input: tu.input,
      };
      allToolCalls.push(toolCall);
      const result = await executeTool(toolCall, input);
      allToolResults.push(result);
      newToolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
        ...(result.isError ? { is_error: true } : {}),
      });
    }
    apiMessages.push({ role: 'user', content: newToolResults });

    // Loop continues — model sees tool results, emits next turn.
  }

  const latencyMs = Date.now() - startedAt;
  await logAiCall({
    purpose,
    model,
    market: input.market ?? null,
    inputTokens: aggregateInputTokens,
    outputTokens: aggregateOutputTokens,
    latencyMs,
  });

  return {
    text: finalText,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    finishReason: finalFinishReason,
    usage: { inputTokens: aggregateInputTokens, outputTokens: aggregateOutputTokens },
    latencyMs,
    model,
  };
}

/* ─── Streaming variant (web chat SSE) ────────────────────────────── */

/**
 * Streaming version. Yields text deltas as the model produces them,
 * buffering tool-call rows until complete (we don't yield partial JSON
 * input blocks — they'd be unparseable on the consumer side).
 *
 * v1 implementation: not actually streaming yet. Calls `converse` and
 * yields the final text as one delta + the done event. Anthropic's
 * SSE protocol (`event: content_block_delta`) is straightforward to
 * wire in a follow-up; the consumer (web chat client) is the same
 * either way. Phase 2 work.
 */
export async function* converseStream(
  input: ConverseInput,
): AsyncGenerator<
  | { kind: 'text-delta'; delta: string }
  | { kind: 'tool-call'; toolCall: ConverseToolCall }
  | { kind: 'done'; output: ConverseOutput }
> {
  const output = await converse(input);
  if (output.text) {
    yield { kind: 'text-delta', delta: output.text };
  }
  for (const tc of output.toolCalls) {
    yield { kind: 'tool-call', toolCall: tc };
  }
  yield { kind: 'done', output };
}

/* ─── Tool execution ──────────────────────────────────────────────── */

async function executeTool(
  call: ConverseToolCall,
  input: ConverseInput,
): Promise<ConverseToolResult> {
  // No supabase client passed → dry-run mode. Return stubbed errors
  // so the model can still demonstrate its tool-use reasoning in
  // tests / harnesses.
  if (!input.supabase) {
    return {
      id: call.id,
      output: { error: 'tool_execution_disabled', detail: 'No supabase client in this caller scope.' },
      isError: true,
    };
  }

  try {
    switch (call.name) {
      case 'lookup_listing':
        return await toolLookupListing(call, input);
      case 'find_comparable':
        return await toolFindComparable(call, input);
      case 'get_agent_availability':
        return await toolGetAgentAvailability(call, input);
      case 'book_viewing':
        return await toolBookViewing(call, input);
      case 'escalate_to_human':
        return await toolEscalateToHuman(call, input);
      default:
        return { id: call.id, output: { error: 'unknown_tool', name: call.name }, isError: true };
    }
  } catch (err) {
    console.error('[converse] tool execution threw', { name: call.name, err });
    return {
      id: call.id,
      output: { error: 'tool_execution_failed', detail: err instanceof Error ? err.message : String(err) },
      isError: true,
    };
  }
}

async function toolLookupListing(
  call: ConverseToolCall,
  input: ConverseInput,
): Promise<ConverseToolResult> {
  const shortId = String(call.input.short_id ?? '').trim();
  if (shortId.length === 0) {
    return { id: call.id, output: { error: 'missing_short_id' }, isError: true };
  }
  const { data, error } = await input.supabase!
    .from('properties')
    .select(
      'id, short_id, title_en, title_es, description_en, description_es, property_type, transaction_type, price_cents, currency, price_period, bedrooms, bathrooms, area_sqm, city, country_code, status, published_at, org_id',
    )
    .eq('short_id', shortId)
    .eq('org_id', input.orgId)
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .maybeSingle();
  if (error) {
    console.error('[converse] lookup_listing postgrest', error);
    return { id: call.id, output: { error: 'lookup_failed' }, isError: true };
  }
  if (!data) {
    return { id: call.id, output: { error: 'not_found_or_not_yours' }, isError: true };
  }
  return { id: call.id, output: data };
}

async function toolFindComparable(
  call: ConverseToolCall,
  input: ConverseInput,
): Promise<ConverseToolResult> {
  const listingId = String(call.input.listing_id ?? '').trim();
  const max = Math.min(10, Math.max(1, Number(call.input.max_results ?? 5) || 5));
  if (listingId.length === 0) {
    return { id: call.id, output: { error: 'missing_listing_id' }, isError: true };
  }
  // Look up the reference listing first (RLS-scoped to the agent's org).
  const { data: ref, error: refErr } = await input.supabase!
    .from('properties')
    .select('id, city, property_type, bedrooms, area_sqm')
    .eq('id', listingId)
    .eq('org_id', input.orgId)
    .maybeSingle();
  if (refErr || !ref) {
    return { id: call.id, output: { error: 'ref_not_found' }, isError: true };
  }
  const { data, error } = await input.supabase!
    .from('properties')
    .select(
      'id, short_id, title_en, title_es, property_type, price_cents, currency, bedrooms, area_sqm, city',
    )
    .eq('org_id', input.orgId)
    .eq('status', 'active')
    .not('published_at', 'is', null)
    .eq('city', ref.city)
    .eq('property_type', ref.property_type)
    .neq('id', ref.id)
    .limit(max);
  if (error) {
    console.error('[converse] find_comparable postgrest', error);
    return { id: call.id, output: { error: 'find_failed' }, isError: true };
  }
  return { id: call.id, output: { count: data?.length ?? 0, items: data ?? [] } };
}

async function toolGetAgentAvailability(
  call: ConverseToolCall,
  _input: ConverseInput,
): Promise<ConverseToolResult> {
  // v1 stub — no calendar integration yet. Return 3 generic slots
  // (next Tue/Thu/Sat at 10am local). A real calendar (Google +
  // Microsoft) integration is v2; documented in AI_AGENT_PLAN §4d
  // for voice, applies equally here.
  const start = new Date(String(call.input.date_range_start ?? new Date().toISOString()));
  const slots: string[] = [];
  const target = new Date(start);
  // Find next Tue (day=2), Thu (4), Sat (6) and offer 10am each.
  for (let i = 0; i < 14 && slots.length < 3; i++) {
    target.setDate(start.getDate() + i);
    const dow = target.getDay();
    if (dow === 2 || dow === 4 || dow === 6) {
      const slot = new Date(target);
      slot.setHours(10, 0, 0, 0);
      slots.push(slot.toISOString());
    }
  }
  return { id: call.id, output: { slots, note: 'v1 stub: real calendar booking is post-v1.' } };
}

async function toolBookViewing(
  call: ConverseToolCall,
  input: ConverseInput,
): Promise<ConverseToolResult> {
  const listingId = String(call.input.listing_id ?? '').trim();
  const buyerName = String(call.input.buyer_name ?? '').trim();
  const buyerContact = String(call.input.buyer_contact ?? '').trim();
  const requestedTime = String(call.input.requested_time ?? '').trim();
  if (!listingId || !buyerName || !buyerContact || !requestedTime) {
    return { id: call.id, output: { error: 'missing_required_field' }, isError: true };
  }
  // Insert a lead row with notes carrying the viewing request. The
  // existing /api/leads write path is where production callers should
  // go for the full email-notification flow; v1 here writes the lead
  // row directly via service-role to keep the tool execution self-
  // contained. Phase 2 will route through the existing lead-routing
  // pipeline (assign_to + Brevo email).
  const isEmail = buyerContact.includes('@');
  const { data, error } = await input.supabase!
    .from('leads')
    .insert({
      org_id: input.orgId,
      property_id: listingId,
      name: buyerName,
      email: isEmail ? buyerContact : null,
      phone: !isEmail ? buyerContact : null,
      source: 'form',
      status: 'new',
      notes: `Viewing requested via AI agent for ${requestedTime}.`,
      language: 'en',
    })
    .select('id')
    .single();
  if (error) {
    console.error('[converse] book_viewing postgrest', error);
    return { id: call.id, output: { error: 'booking_failed' }, isError: true };
  }
  return {
    id: call.id,
    output: {
      booking_id: data.id,
      confirmation_text:
        'Viewing request recorded. The agent will confirm shortly and reach out with the exact address + access details.',
    },
  };
}

async function toolEscalateToHuman(
  call: ConverseToolCall,
  input: ConverseInput,
): Promise<ConverseToolResult> {
  const reason = String(call.input.reason ?? '').slice(0, 500);
  // Flip the conversation to 'escalated' status. The dashboard inbox
  // surfaces escalated threads at the top with a red badge.
  const { error } = await input.supabase!
    .from('ai_conversations')
    .update({ status: 'escalated', updated_at: new Date().toISOString() })
    .eq('id', input.conversationId)
    .eq('org_id', input.orgId);
  if (error) {
    console.error('[converse] escalate_to_human postgrest', error);
    return { id: call.id, output: { error: 'escalate_failed' }, isError: true };
  }
  return {
    id: call.id,
    output: {
      escalated: true,
      reason,
      message:
        "The agent has been notified and will respond personally within a few hours. Is there anything else I can answer in the meantime?",
    },
  };
}

/* ─── Helpers ──────────────────────────────────────────────────────── */

function normalizeFinishReason(raw: string | undefined): FinishReason {
  switch (raw) {
    case 'end_turn':
    case 'max_tokens':
    case 'tool_use':
    case 'stop_sequence':
      return raw;
    default:
      return 'unknown';
  }
}
