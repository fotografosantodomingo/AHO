/**
 * Unit tests for `src/lib/voice/warm-transfer.ts`.
 *
 * Pure-function tests — no network. Validates the TwiML output for
 * the warm-transfer Conference flow:
 *   - Contains the agent's mobile (E.164)
 *   - Contains the whisper prompt summarizing the lead
 *   - Contains a Conference element named for the call SID
 *   - XML escapes special characters in dynamic values
 *   - Honors the ring-timeout bounds (5-60s)
 *   - Sets caller-ID to the buyer's number so the agent sees it
 */

import { describe, expect, it } from 'vitest';
import { buildTwilioWarmTransferDial } from '@/lib/voice/warm-transfer';

const base = {
  agentMobile: '+18095551234',
  callSid: 'CAabcdef0123456789',
  whisperPrompt:
    'Buyer Sarah Chen asking about the villa in Santo Domingo. Callback: +14155556789. Wants to schedule a viewing this weekend.',
  buyerPhone: '+14155556789',
};

describe('buildTwilioWarmTransferDial', () => {
  it('returns a well-formed TwiML document with the XML declaration', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\s*<Response>/);
    expect(xml).toMatch(/<\/Response>\s*$/);
  });

  it('contains the agent mobile in a <Number> element', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toContain('<Number');
    expect(xml).toContain('+18095551234');
  });

  it('contains the whisper prompt (in the XML comment for Worker pickup)', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toContain('Sarah Chen');
    expect(xml).toContain('villa in Santo Domingo');
    // Whisper prompt lives inside the conventional whisper comment so
    // the parallel agent-dial REST API call can read it without
    // re-encoding.
    expect(xml).toMatch(/<!-- whisper: .*Sarah Chen.* -->/);
  });

  it('contains a Conference element named for the call SID', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toContain('<Conference');
    expect(xml).toContain('aho-CAabcdef0123456789');
  });

  it('sets caller-ID to the buyer phone (so the agent sees who is calling)', () => {
    const xml = buildTwilioWarmTransferDial(base);
    // <Dial callerId="+14155556789">
    expect(xml).toMatch(/callerId="\+14155556789"/);
  });

  it('records the bridged conference for the agent\'s protection', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toContain('record="record-from-start"');
  });

  it('honors the default 20-second ring timeout', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toMatch(/timeout="20"/);
  });

  it('clamps a too-low ring timeout to the 5-second floor', () => {
    const xml = buildTwilioWarmTransferDial({ ...base, ringTimeoutSeconds: 1 });
    expect(xml).toMatch(/timeout="5"/);
  });

  it('clamps a too-high ring timeout to the 60-second ceiling', () => {
    const xml = buildTwilioWarmTransferDial({ ...base, ringTimeoutSeconds: 300 });
    expect(xml).toMatch(/timeout="60"/);
  });

  it('XML-escapes special characters in the whisper prompt', () => {
    const xml = buildTwilioWarmTransferDial({
      ...base,
      whisperPrompt: 'Buyer asking about <luxury> & "villa" with O\'Brien terms.',
    });
    expect(xml).toContain('&lt;luxury&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;villa&quot;');
    expect(xml).toContain("O&apos;Brien");
    // Raw special chars must NOT leak past the escape.
    expect(xml).not.toMatch(/<luxury>/);
  });

  it('XML-escapes the agent mobile + buyer phone (defense-in-depth)', () => {
    const xml = buildTwilioWarmTransferDial({
      ...base,
      agentMobile: '+1809<555>1234',
      buyerPhone: '+1415"5556789',
    });
    expect(xml).toContain('+1809&lt;555&gt;1234');
    expect(xml).toContain('+1415&quot;5556789');
  });

  it('wires the whisper URL onto the agent Dial when provided', () => {
    const xml = buildTwilioWarmTransferDial({
      ...base,
      whisperUrl: 'https://advertisehomes.online/api/voice/whisper?p=abc',
    });
    expect(xml).toMatch(/whisper="https:\/\/advertisehomes.online\/api\/voice\/whisper\?p=abc"/);
  });

  it('omits the whisper attribute when no URL provided (v1 default)', () => {
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).not.toMatch(/whisper="/);
  });

  it('wires the fallback action URL when provided', () => {
    const xml = buildTwilioWarmTransferDial({
      ...base,
      fallbackActionUrl: 'https://advertisehomes.online/api/voice/voicemail',
    });
    expect(xml).toContain('action="https://advertisehomes.online/api/voice/voicemail"');
  });

  it('Conference element exits when the joining party leaves (cleanup)', () => {
    // endConferenceOnExit=true on the buyer-leg conference makes sure
    // the bridge tears down cleanly when the agent hangs up.
    const xml = buildTwilioWarmTransferDial(base);
    expect(xml).toContain('endConferenceOnExit="true"');
  });

  it('produces output suitable for Response body (text/xml)', () => {
    const xml = buildTwilioWarmTransferDial(base);
    // No control characters that would break Twilio's XML parser.
    expect(xml).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    // Reasonable length — not pathologically small or large.
    expect(xml.length).toBeGreaterThan(200);
    expect(xml.length).toBeLessThan(4000);
  });
});
