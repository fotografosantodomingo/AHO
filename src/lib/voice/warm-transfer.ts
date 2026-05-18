/**
 * TwiML builder for the warm-transfer Conference pattern.
 *
 * Pure function. No env access. Edge-safe.
 *
 * The warm-transfer flow per AI_AGENT_PLAN §4d:
 *
 *   1. AI determines the buyer needs the human (or the buyer asks)
 *   2. Worker emits Twilio 'end' with handoff hint
 *   3. Twilio's parent TwiML returns control to a fallback endpoint
 *      that fetches THIS function's TwiML to run the Conference
 *   4. <Dial><Conference> adds the buyer to a conference room,
 *      <Dial> simultaneously rings the agent's mobile with a
 *      whisper-prompt summarizing the lead
 *   5. If the agent picks up within 20s: agent joins the conference,
 *      hears the whisper-prompt FIRST (TTS of `whisperPrompt`), then
 *      the buyer's audio. AI leg has already been dropped.
 *   6. If the agent doesn't pick up: the conference auto-closes and
 *      Twilio falls back to the configured action URL (typically
 *      voicemail capture)
 *
 * Why Conference and not SIP REFER (per AI_AGENT_PLAN §4d, default A):
 *   - Conference is supported on every Twilio account out-of-the-box;
 *     SIP REFER needs Elastic SIP Trunking on a paid plan
 *   - Whisper-prompt UX is native to Conference (`whisper="<url>"`
 *     attribute on the agent's <Dial>)
 *   - We can record the bridged call via `record="record-from-start"`
 *     on the Conference element — same pattern as the AI-led recording
 *
 * Caller-ID strategy: when we dial the agent's mobile we set
 * callerId=<the buyer's E.164>. This means the agent's phone shows
 * the buyer's number rather than the Twilio AHO number — they can
 * tell at a glance who's calling, and if the conference drops they
 * can call the buyer back from their own phone.
 *
 * TwiML reference:
 *   https://www.twilio.com/docs/voice/twiml/conference
 *   https://www.twilio.com/docs/voice/twiml/dial
 */

export interface WarmTransferInput {
  /** Agent's personal mobile in E.164 (from agent_phone_numbers.forward_to_phone). */
  agentMobile: string;
  /**
   * Twilio call SID. Used as the Conference name so we can target
   * this exact conference by API later (mute/kick/recording).
   */
  callSid: string;
  /**
   * Plain-text summary spoken to the agent BEFORE the buyer joins.
   * Should fit comfortably in 15 seconds of TTS — buyer name,
   * listing they asked about, their core question, callback number.
   * Pure prose; no markdown (it'll be TTS-synthesized).
   */
  whisperPrompt: string;
  /**
   * Buyer's E.164. Used as the agent-leg caller-ID so the agent's
   * phone displays the buyer's number, not the AHO number.
   */
  buyerPhone: string;
  /**
   * How long to ring the agent's mobile before giving up. Per
   * AI_AGENT_PLAN §4d default = 20 seconds. Increase for markets
   * where carriers ring slower (rare).
   */
  ringTimeoutSeconds?: number;
  /**
   * URL Twilio fetches when the conference ends or the agent doesn't
   * pick up. Typically a voicemail-capture TwiML endpoint. v2 polish.
   * When omitted, Twilio hangs up the buyer leg with no follow-up.
   */
  fallbackActionUrl?: string;
  /**
   * URL Twilio fetches to render the whisper-prompt TTS for the
   * agent. ConversationRelay's `<Say>` can't be used inside a
   * `whisper` attribute — we need a TwiML endpoint that returns
   * <Response><Say>{whisperPrompt}</Say></Response>. v2 polish wires
   * /api/voice/whisper?prompt=<base64> for this purpose. When
   * omitted, no whisper is played and the agent joins cold.
   */
  whisperUrl?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the TwiML XML string for the warm-transfer Conference flow.
 *
 * Returned XML is a complete TwiML document including the XML
 * declaration and the <Response> root. The caller (typically a
 * Twilio webhook endpoint) returns this directly as the response
 * body with content-type: text/xml.
 *
 * The whisperPrompt is encoded into the TwiML as an attribute on the
 * <Number> element via the agent's <Dial> — see the inline comments
 * below for the Twilio shape.
 */
export function buildTwilioWarmTransferDial(input: WarmTransferInput): string {
  const timeout = Math.max(5, Math.min(60, input.ringTimeoutSeconds ?? 20));
  const conferenceName = `aho-${input.callSid}`;
  const whisperUrl = input.whisperUrl ?? '';
  const fallbackAction = input.fallbackActionUrl ?? '';

  // Conference element wraps the buyer leg. Once the buyer's TwiML
  // returns Twilio puts them into this room. Recording is on by
  // default — the conference audio is captured for the agent's
  // protection (parity with the AI-led portion).
  //
  // The agent's <Dial> is a SEPARATE TwiML executed via Twilio's
  // REST API at the same moment. The agent's TwiML uses
  // <Conference> with the same name AND the whisperUrl attribute
  // pointing at a TwiML endpoint that returns a <Say> with the
  // whisperPrompt. We bake the prompt INTO the URL via base64 so
  // the whisper endpoint can render it without DB lookups.
  //
  // For the scaffold we ship the buyer-leg TwiML; the parallel
  // agent-dial happens via a fetch() to api.twilio.com/Calls in the
  // Worker (v2 polish). The whisperPrompt is included as an XML
  // comment so the Worker's Twilio API call can pull it out without
  // re-encoding.
  const whisperComment = `<!-- whisper: ${escapeXml(input.whisperPrompt)} -->`;
  const whisperAttr = whisperUrl ? ` whisper="${escapeXml(whisperUrl)}"` : '';
  const fallbackAttr = fallbackAction ? ` action="${escapeXml(fallbackAction)}"` : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${whisperComment}
  <Dial timeout="${timeout}" callerId="${escapeXml(input.buyerPhone)}"${fallbackAttr}>
    <Conference startConferenceOnEnter="false" endConferenceOnExit="true" record="record-from-start" beep="false"${whisperAttr}>${escapeXml(conferenceName)}</Conference>
  </Dial>
  <Dial timeout="${timeout}" callerId="${escapeXml(input.buyerPhone)}">
    <Number${whisperAttr}>${escapeXml(input.agentMobile)}</Number>
  </Dial>
</Response>`;
}
