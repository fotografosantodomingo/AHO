import { type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * GET /api/voice/twiml
 *
 * The TwiML endpoint Twilio fetches when a configured AHO number
 * receives an inbound call. Phase 5 of `docs/AI_AGENT_PLAN.md` (§4d).
 *
 * Flow per inbound call:
 *   1. Caller dials an AHO-provisioned Twilio number
 *   2. Twilio fetches this route (the "A call comes in" webhook on
 *      the number, set in the Twilio Console — PO-side action)
 *   3. We look up the agent_phone_numbers row by the dialed E.164
 *      number (the `To` query param Twilio injects on every webhook)
 *   4. We return TwiML that opens a WebSocket to the
 *      aho-voice-conversationrelay Worker via the
 *      <Connect><ConversationRelay/> primitive, picking the right
 *      ElevenLabs voice for the agent's market
 *
 * Twilio webhook query params (we only consume the ones we need):
 *   - To       — the dialed AHO number (E.164)
 *   - From     — the caller's number (E.164 when available)
 *   - CallSid  — Twilio's call identifier (CAxxx)
 *   - CallStatus — usually 'ringing' on the first fetch
 *
 * Failure modes:
 *   - Unknown number   → return a TwiML <Say> with a polite error,
 *                        then <Hangup>. Caller hears "Sorry, that
 *                        number isn't set up..." rather than dead air.
 *   - Inactive number  → same path as unknown (status='pending' or
 *                        'suspended' means the agent isn't ready)
 *   - DB error         → log + return a generic fallback TwiML so the
 *                        caller isn't stuck on a TCP timeout
 *
 * Twilio signature verification:
 *   v1 ships without `X-Twilio-Signature` HMAC verification on this
 *   GET endpoint. The Worker enforces it on the WebSocket upgrade
 *   (where the security boundary actually matters). Adding a
 *   signature check here too is a v2 polish — it would harden against
 *   an attacker who learned the exact URL + dialed-number combo, but
 *   the worst case is the attacker gets back a publicly-derivable
 *   TwiML pointing at our WebSocket, where the real auth happens.
 */

const WORKER_BASE_URL =
  process.env.AHO_VOICE_WS_URL ?? 'wss://aho-voice-conversationrelay.workers.dev';

/**
 * Voice-id selection per market.
 *
 * ConversationRelay's `voice` attribute on the <ConversationRelay>
 * element selects the TTS voice. Per AI_AGENT_PLAN §4d we use
 * ElevenLabs Flash v2.5 for low-latency synthesis. ElevenLabs voice
 * IDs are opaque strings (e.g., '21m00Tcm4TlvDq8ikWAM'); we pick one
 * per (market, gender) pair.
 *
 * v1 ships with English-only voices (the Worker greets in English
 * regardless of market until the converse() bridge lands). The
 * placeholders below are the documented public ElevenLabs voices —
 * PO action to replace with the actual cloned-or-licensed voice IDs
 * once the ElevenLabs account is provisioned. Per-market voice
 * library is a Phase 5 ship-gate item in `STATUS.md`.
 *
 * Why per-market: a US buyer expects an American accent, an Italian
 * buyer expects an Italian-accented Italian voice, etc. The Twilio
 * default 'man'/'woman' voices sound robotic compared to ElevenLabs;
 * the +$0.05/min ElevenLabs uplift is justified at the agent-CSAT
 * level (we lose deals to "your AI sounded like a Cylon" feedback).
 */
function selectVoice(market: AgentMarket): string {
  switch (market) {
    case 'es':
      // Spanish — TODO: replace with ElevenLabs ES voice id post-onboarding
      return 'es-ES-Standard-A';
    case 'pl':
      return 'pl-PL-Standard-A';
    case 'pt':
      return 'pt-PT-Standard-A';
    case 'de':
      return 'de-DE-Standard-F';
    case 'fr':
      return 'fr-FR-Standard-E';
    case 'it':
      return 'it-IT-Standard-A';
    case 'us':
    default:
      return 'en-US-Standard-C';
  }
}

type AgentMarket = 'us' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';

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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function twimlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    status: 200,
    headers: {
      'content-type': 'text/xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function fallbackTwiml(message: string): string {
  return `<Response>\n  <Say voice="alice">${escapeXml(message)}</Say>\n  <Hangup/>\n</Response>`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get('To') ?? url.searchParams.get('to');
  const callSid = url.searchParams.get('CallSid') ?? '';

  if (!to) {
    console.error('[voice/twiml] missing To param', { callSid });
    return twimlResponse(
      fallbackTwiml("Sorry, this number isn't configured. Please try again later."),
    );
  }

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (err) {
    console.error('[voice/twiml] admin client init failed', err);
    return twimlResponse(
      fallbackTwiml("Sorry, we're having a technical issue. Please try again in a moment."),
    );
  }

  // Look up the agent's row. Service-role bypass; we explicitly
  // filter status='active' so suspended numbers don't accept calls.
  const { data: phone, error } = await supabase
    .from('agent_phone_numbers')
    .select(
      'id, agent_id, org_id, phone_e164, status, organizations!inner(headquarters_country)',
    )
    .eq('phone_e164', to)
    .eq('status', 'active')
    .maybeSingle();
  if (error) {
    console.error('[voice/twiml] postgrest', {
      code: error.code,
      message: error.message,
      to,
      callSid,
    });
    return twimlResponse(
      fallbackTwiml("Sorry, we're having a technical issue. Please try again in a moment."),
    );
  }
  if (!phone) {
    console.error('[voice/twiml] no active row for number', { to, callSid });
    return twimlResponse(
      fallbackTwiml(
        "Sorry, that number isn't set up for AI assistance yet. Please leave a message after the tone.",
      ),
    );
  }

  // Resolve market via the org's headquarters country. Same heuristic
  // as src/app/api/ai-chat/route.ts so chat / voice voices stay in
  // sync per agent.
  const orgRow = phone.organizations as { headquarters_country?: string | null } | null;
  const market = countryToMarket(orgRow?.headquarters_country ?? null);
  const voice = selectVoice(market);
  const wsUrl = `${WORKER_BASE_URL}/?to=${encodeURIComponent(to)}`;

  // The TwiML envelope. <Connect> opens a bidirectional media stream;
  // <ConversationRelay> is the Twilio×Anthropic primitive that does
  // STT (Deepgram Nova-3 by default) + TTS (ElevenLabs Flash v2.5
  // when `voice` is an ElevenLabs id; falls back to Polly otherwise).
  //
  // Attributes we set:
  //   - url           — WebSocket the Worker accepts
  //   - voice         — TTS voice id (see selectVoice)
  //   - welcomeGreeting — initial spoken line BEFORE the WS opens;
  //                       v1 omits this and lets the Worker greet via
  //                       the first 'text' frame (latency parity)
  //   - transcriptionProvider — 'deepgram' for Nova-3 (latency floor)
  //   - language      — buyer-side STT hint; we send the market
  //                     default. ConversationRelay also auto-detects.
  //   - interruptByDtmf — true so a touch-tone can interrupt the AI
  //                       (handled in the Worker as a 'dtmf' event)
  //
  // The query-string `to` param echoes the dialed number into the
  // WebSocket URL so the Worker can re-look-up the row without
  // depending on the setup event. Defense-in-depth.
  const twiml = `<Response>
  <Connect>
    <ConversationRelay url="${escapeXml(wsUrl)}" voice="${escapeXml(voice)}" transcriptionProvider="deepgram" language="${escapeXml(marketToBcp47(market))}" interruptByDtmf="true"/>
  </Connect>
</Response>`;

  return twimlResponse(twiml);
}

/** Map a market to a BCP-47 language tag for STT hints. */
function marketToBcp47(market: AgentMarket): string {
  switch (market) {
    case 'es':
      return 'es-ES';
    case 'pl':
      return 'pl-PL';
    case 'pt':
      return 'pt-PT';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'it':
      return 'it-IT';
    case 'us':
    default:
      return 'en-US';
  }
}
