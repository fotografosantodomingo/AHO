/**
 * AHO — Voice channel WebSocket handler for Twilio ConversationRelay.
 *
 * Twilio terminates the PSTN call (caller dials the agent's AHO number,
 * Twilio handles SIP / codecs / audio) and proxies the conversation
 * over a WebSocket to this Worker via the
 * `<Connect><ConversationRelay url="wss://..."/></Connect>` TwiML
 * primitive returned by /api/voice/twiml. Speech-to-text + text-to-
 * speech happen INSIDE ConversationRelay; we receive already-
 * transcribed user turns and emit text replies that Twilio synthesizes
 * back to audio.
 *
 * Phase 5 v1 scope:
 *   - Accept the WS upgrade + parse the Twilio setup event
 *   - Look up the agent_phone_number by the dialed `to` number
 *   - Create or resume the ai_conversations row (channel='voice')
 *   - Insert the voice_calls row with the Twilio call_sid
 *   - Greet the buyer with buildVoiceGreeting (lib/voice/voice-prompts)
 *   - On each "prompt" event: log the transcript to console.error
 *     (observability stub) + emit a placeholder reply. The actual
 *     converse() bridge is left as a TODO — needs the inter-service
 *     auth pattern + an /api/ai-chat-internal/voice Edge route.
 *   - On "transfer-required" / explicit escalate: terminate with
 *     reason=transfer-to-agent and surface the agent's mobile.
 *   - On "end": finalize the voice_calls row (duration, cost).
 *
 * What's deliberately deferred (v2 polish):
 *   - The real converse() bridge — wire the Pages route + INBOUND_SECRET
 *   - Recording upload to R2 (Twilio recording-callback handler)
 *   - Per-turn cost attribution to ai_generation_log
 *   - Warm-transfer Conference orchestration (lib/voice/warm-transfer
 *     ships the TwiML; this Worker doesn't dial it yet)
 *
 * PO-side gating before this Worker goes live (see README):
 *   1. Twilio account + buy a phone number
 *   2. Configure number → "When a call comes in" → /api/voice/twiml
 *   3. Set Worker secrets (TWILIO_AUTH_TOKEN, INBOUND_SECRET, etc)
 *
 * CLAUDE.md gotcha discipline:
 *   - Every supabase write is `await`ed (Edge cancels unawaited promises)
 *   - Every `{ error }` is destructured (supabase-js doesn't throw on
 *     row-level errors)
 *   - console.error for in-Worker observability (visible in
 *     `wrangler tail`); console.log is unreliable in pretty mode
 */

interface Env {
  TWILIO_AUTH_TOKEN: string;
  INBOUND_SECRET: string;
  AHO_PAGES_URL: string;
  AHO_VOICE_BRIDGE_PATH: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  LOG_LEVEL: string;
}

/* ─── Twilio ConversationRelay wire format ──────────────────────────── */
//
// Twilio sends these events as JSON text frames over the WebSocket.
// Reference: https://www.twilio.com/docs/voice/conversationrelay/events
//
// Inbound (Twilio → Worker):
//   - "setup"        — first event; carries callSid, from, to
//   - "prompt"       — a user turn that STT just transcribed
//   - "interrupted"  — buyer started speaking over the AI
//   - "dtmf"         — touch-tone keypress (v2; we don't handle yet)
//   - "end"          — call terminated (caller hung up or transfer
//                      completed)
//
// Outbound (Worker → Twilio):
//   - "text"         — assistant reply for TTS playback
//   - "end"          — explicit termination from our side; carries a
//                      reason like 'transfer-to-agent' or 'voicemail'

interface TwilioSetupEvent {
  type: 'setup';
  callSid: string;
  from: string;
  to: string;
  callStatus?: string;
  direction?: 'inbound' | 'outbound';
}

interface TwilioPromptEvent {
  type: 'prompt';
  voicePrompt: string;
  /** Confidence as 0-1 from Twilio STT (Deepgram under the hood). */
  confidence?: number;
}

interface TwilioInterruptedEvent {
  type: 'interrupted';
}

interface TwilioEndEvent {
  type: 'end';
  reason?: string;
}

interface TwilioDtmfEvent {
  type: 'dtmf';
  digit: string;
}

type TwilioInboundEvent =
  | TwilioSetupEvent
  | TwilioPromptEvent
  | TwilioInterruptedEvent
  | TwilioEndEvent
  | TwilioDtmfEvent;

/* ─── Per-WebSocket session state ───────────────────────────────────── */

interface SessionState {
  callSid: string;
  fromPhone: string;
  toPhone: string;
  agentPhoneId: string | null;
  agentId: string | null;
  orgId: string | null;
  conversationId: string | null;
  voiceCallId: string | null;
  /** Wall-clock at "setup" event. Used to compute duration on "end". */
  startedAt: number;
  /** Buffer of (role, text) for the converse() bridge — v1 logs only. */
  turns: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** True once warm-transfer was attempted; used at "end" to compute
   *  the warm_transfer_succeeded telemetry. */
  transferAttempted: boolean;
}

function newSessionState(): SessionState {
  return {
    callSid: '',
    fromPhone: '',
    toPhone: '',
    agentPhoneId: null,
    agentId: null,
    orgId: null,
    conversationId: null,
    voiceCallId: null,
    startedAt: Date.now(),
    turns: [],
    transferAttempted: false,
  };
}

/* ─── Twilio outbound event helpers ─────────────────────────────────── */

function sendText(socket: WebSocket, text: string): void {
  // Twilio's "text" event triggers TTS playback on the caller's
  // line. Keep replies short — sentence-level chunks land more
  // naturally than paragraph dumps. ConversationRelay buffers a few
  // KB before forcing playback, so we send the whole reply in one
  // message rather than character-streaming.
  const frame = JSON.stringify({
    type: 'text',
    token: text,
    last: true,
  });
  try {
    socket.send(frame);
  } catch (err) {
    console.error('[voice-cr] socket.send failed', err);
  }
}

function sendEnd(socket: WebSocket, reason: string, handoffData?: Record<string, unknown>): void {
  const frame = JSON.stringify({
    type: 'end',
    handoffData: { reason, ...(handoffData ?? {}) },
  });
  try {
    socket.send(frame);
  } catch (err) {
    console.error('[voice-cr] socket.send(end) failed', err);
  }
}

/* ─── Supabase direct REST helpers ──────────────────────────────────── */
//
// We don't bundle supabase-js here — keeps the Worker lean. The PostgREST
// REST API is simple enough that raw fetch + the service-role key is the
// pragmatic path. Same precedent: workers/instagram-drift/.

async function supabaseSelectOne<T>(
  env: Env,
  table: string,
  query: string,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { data: null, error: `postgrest_${res.status}:${detail.slice(0, 200)}` };
    }
    const rows = (await res.json()) as T[];
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function supabaseInsertReturning<T>(
  env: Env,
  table: string,
  row: Record<string, unknown>,
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { data: null, error: `postgrest_${res.status}:${detail.slice(0, 200)}` };
    }
    const rows = (await res.json()) as T[];
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function supabaseUpdate(
  env: Env,
  table: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { error: `postgrest_${res.status}:${detail.slice(0, 200)}` };
    }
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/* ─── Event handlers ────────────────────────────────────────────────── */

interface AgentPhoneRow {
  id: string;
  agent_id: string;
  org_id: string;
  phone_e164: string;
  forward_to_phone: string | null;
  status: string;
}

async function handleSetup(
  env: Env,
  socket: WebSocket,
  state: SessionState,
  event: TwilioSetupEvent,
): Promise<void> {
  state.callSid = event.callSid;
  state.fromPhone = event.from;
  state.toPhone = event.to;
  state.startedAt = Date.now();

  // 1. Find the agent's row by dialed number.
  const { data: phone, error: phoneErr } = await supabaseSelectOne<AgentPhoneRow>(
    env,
    'agent_phone_numbers',
    `select=id,agent_id,org_id,phone_e164,forward_to_phone,status&phone_e164=eq.${encodeURIComponent(event.to)}&status=eq.active&limit=1`,
  );
  if (phoneErr || !phone) {
    console.error('[voice-cr] setup: agent phone lookup failed', { to: event.to, err: phoneErr });
    sendText(
      socket,
      "Sorry, that number isn't set up for AI assistance yet. Please try again later.",
    );
    sendEnd(socket, 'agent_phone_not_found');
    return;
  }
  state.agentPhoneId = phone.id;
  state.agentId = phone.agent_id;
  state.orgId = phone.org_id;

  // 2. Create-or-resume the conversation. v1 simplification: always
  //    start a new conversation per call (no buyer_phone match across
  //    calls yet — that's a v2 cross-channel resume).
  const { data: conv, error: convErr } = await supabaseInsertReturning<{ id: string }>(
    env,
    'ai_conversations',
    {
      org_id: phone.org_id,
      agent_id: phone.agent_id,
      channel: 'voice',
      status: 'open',
      buyer_locale: 'en',
      buyer_phone: event.from,
      first_message_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    },
  );
  if (convErr || !conv) {
    console.error('[voice-cr] setup: conversation insert failed', { err: convErr });
    sendText(socket, "Sorry, I'm having trouble connecting. Please try again in a moment.");
    sendEnd(socket, 'conversation_insert_failed');
    return;
  }
  state.conversationId = conv.id;

  // 3. Insert the voice_calls row.
  const { data: call, error: callErr } = await supabaseInsertReturning<{ id: string }>(
    env,
    'voice_calls',
    {
      conversation_id: conv.id,
      agent_phone_id: phone.id,
      twilio_call_sid: event.callSid,
      direction: 'inbound',
      from_phone: event.from,
      recording_consent: true,
    },
  );
  if (callErr || !call) {
    console.error('[voice-cr] setup: voice_calls insert failed', { err: callErr });
    // Soft-fail: continue the call without the row; the conversation
    // is still captured. Surface in `wrangler tail` for diagnosis.
  } else {
    state.voiceCallId = call.id;
  }

  // 4. Greet the caller. v1 uses a static English opener — full
  //    locale-aware greeting flows through buildVoiceGreeting in
  //    src/lib/voice/voice-prompts.ts once the converse() bridge is
  //    wired. The Worker can't currently import from src/ without a
  //    bundler step; we duplicate the opener string here.
  const greeting =
    "Hi, this is the AHO AI assistant. How can I help you today?";
  sendText(socket, greeting);
  state.turns.push({ role: 'assistant', text: greeting });
}

async function handlePrompt(
  env: Env,
  socket: WebSocket,
  state: SessionState,
  event: TwilioPromptEvent,
): Promise<void> {
  if (!state.conversationId) {
    console.error('[voice-cr] prompt without conversationId; ignoring', event);
    return;
  }
  const userText = (event.voicePrompt ?? '').trim();
  if (!userText) return;

  state.turns.push({ role: 'user', text: userText });
  console.error('[voice-cr] user-turn', {
    callSid: state.callSid,
    text: userText.slice(0, 200),
    confidence: event.confidence,
  });

  // Persist the user turn into ai_conversation_messages. Best-effort;
  // failures don't drop the call.
  const { error: msgErr } = await supabaseInsertReturning(env, 'ai_conversation_messages', {
    conversation_id: state.conversationId,
    role: 'user',
    channel: 'voice',
    body: userText,
  });
  if (msgErr) {
    console.error('[voice-cr] user-turn insert failed', { err: msgErr });
  }

  // TODO: wire converse() — needs inter-service auth pattern.
  //
  // The real bridge: POST to ${AHO_PAGES_URL}${AHO_VOICE_BRIDGE_PATH}
  // with { conversationId, agentId, orgId, userMessage, prior turns }
  // and INBOUND_SECRET as a bearer. The Pages route runs converse()
  // from src/lib/ai/converse.ts (which logs to ai_generation_log,
  // executes tools, returns the assistant text) and returns the
  // assistant reply + a hint flag when the model called
  // escalate_to_human. The Worker emits the text via sendText() and
  // forwards transfer requests to handleTransferRequired().
  //
  // v1 stub: echo back a canned acknowledgement so the call doesn't
  // dead-end during local testing without the Pages route. The
  // observability transcript above gives the operator everything
  // they need to validate the pipeline.
  const reply = "Thanks, let me check on that for you. One moment please.";
  sendText(socket, reply);
  state.turns.push({ role: 'assistant', text: reply });

  // Persist the assistant turn.
  const { error: replyErr } = await supabaseInsertReturning(env, 'ai_conversation_messages', {
    conversation_id: state.conversationId,
    role: 'assistant',
    channel: 'voice',
    body: reply,
    approval_status: 'auto_sent',
    sent_at: new Date().toISOString(),
  });
  if (replyErr) {
    console.error('[voice-cr] assistant-turn insert failed', { err: replyErr });
  }
}

async function handleTransferRequired(
  env: Env,
  socket: WebSocket,
  state: SessionState,
): Promise<void> {
  state.transferAttempted = true;
  if (!state.agentPhoneId) {
    sendText(
      socket,
      "I'm having trouble reaching the agent. Could you leave a brief message and a callback number?",
    );
    return;
  }

  // Look up the warm-transfer mobile.
  const { data: phone } = await supabaseSelectOne<AgentPhoneRow>(
    env,
    'agent_phone_numbers',
    `select=id,agent_id,org_id,phone_e164,forward_to_phone,status&id=eq.${state.agentPhoneId}&limit=1`,
  );
  const mobile = phone?.forward_to_phone ?? null;
  if (!mobile) {
    sendText(
      socket,
      "The agent isn't reachable right now. I'll have them call you back as soon as possible.",
    );
    sendEnd(socket, 'no_forward_number');
    return;
  }

  // Hand off: emit Twilio "end" with the dial-out hint. Twilio's
  // ConversationRelay returns control to the parent TwiML, which then
  // executes the warm-transfer <Dial><Conference> sequence — see
  // src/lib/voice/warm-transfer.ts for the TwiML shape. Phase 5 v1
  // ships the TwiML builder but doesn't actually dial; v2 polish will.
  sendText(
    socket,
    "Connecting you to the agent now. One moment please.",
  );
  sendEnd(socket, 'transfer-to-agent', { forwardTo: mobile });
}

async function handleEnd(
  env: Env,
  state: SessionState,
  event: TwilioEndEvent,
): Promise<void> {
  if (!state.voiceCallId) {
    console.error('[voice-cr] end without voiceCallId', { callSid: state.callSid });
    return;
  }
  const durationSeconds = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));

  // Cost computation is a v2 polish item — we'd import lib/voice/pricing
  // here once the Worker can resolve the agent's market. v1 just
  // stores duration; the dashboard rollup can multiply later.
  const { error } = await supabaseUpdate(env, 'voice_calls', `id=eq.${state.voiceCallId}`, {
    duration_seconds: durationSeconds,
    warm_transfer_attempted: state.transferAttempted,
    // warm_transfer_succeeded computed by the status-callback handler
    // once Twilio confirms the bridged agent leg connected; v2.
  });
  if (error) {
    console.error('[voice-cr] end: voice_calls patch failed', { err: error });
  }

  console.error('[voice-cr] call-end', {
    callSid: state.callSid,
    durationSeconds,
    reason: event.reason ?? 'caller_hangup',
    transferAttempted: state.transferAttempted,
    turns: state.turns.length,
  });
}

/* ─── WebSocket handler ─────────────────────────────────────────────── */

async function handleWebSocket(env: Env, socket: WebSocket): Promise<void> {
  const state = newSessionState();
  socket.accept();

  socket.addEventListener('message', async (evt) => {
    let parsed: TwilioInboundEvent;
    try {
      const raw = typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer);
      parsed = JSON.parse(raw) as TwilioInboundEvent;
    } catch (err) {
      console.error('[voice-cr] bad frame', err);
      return;
    }

    try {
      switch (parsed.type) {
        case 'setup':
          await handleSetup(env, socket, state, parsed);
          break;
        case 'prompt':
          await handlePrompt(env, socket, state, parsed);
          break;
        case 'interrupted':
          // Buyer started speaking over the AI. v1: just acknowledge in
          // logs; ConversationRelay handles the audio-side interrupt.
          console.error('[voice-cr] interrupted', { callSid: state.callSid });
          break;
        case 'dtmf':
          console.error('[voice-cr] dtmf (ignored in v1)', { callSid: state.callSid, digit: parsed.digit });
          break;
        case 'end':
          await handleEnd(env, state, parsed);
          break;
        default:
          // Unknown event type — Twilio added something we don't handle yet.
          console.error('[voice-cr] unknown event', parsed);
      }
    } catch (err) {
      console.error('[voice-cr] handler threw', { type: parsed.type, err });
    }
  });

  socket.addEventListener('close', async () => {
    // Twilio may close without an explicit "end" event in error paths.
    // Make sure the row is finalized either way.
    if (state.voiceCallId && state.startedAt) {
      const durationSeconds = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
      const { error } = await supabaseUpdate(env, 'voice_calls', `id=eq.${state.voiceCallId}`, {
        duration_seconds: durationSeconds,
        warm_transfer_attempted: state.transferAttempted,
      });
      if (error) {
        console.error('[voice-cr] close: voice_calls patch failed', { err: error });
      }
    }
  });
}

/* ─── HTTP entrypoint (WebSocket upgrade) ───────────────────────────── */

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return new Response('ok', { status: 200 });
    }

    const upgrade = req.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response(
        'aho-voice-conversationrelay — Twilio ConversationRelay WebSocket endpoint. Upgrade required.',
        { status: 426 },
      );
    }

    // TODO: validate the X-Twilio-Signature header on the upgrade
    // request. Twilio signs WebSocket-upgrade requests with the same
    // HMAC-SHA1 scheme as HTTP webhooks. PO action — needs
    // TWILIO_AUTH_TOKEN secret set first. v1 ships the scaffold
    // without enforcement so local testing with `wscat` works.

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    await handleWebSocket(env, server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  },
};
