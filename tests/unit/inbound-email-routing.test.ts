import { describe, expect, it } from 'vitest';
import {
  decodeLeadsToken,
  encodeLeadsToken,
  parseLocalPart,
} from '../../src/lib/email/inbound-routing';

/**
 * Unit tests for the inbound-email routing helpers.
 *
 * Surface under test: `src/lib/email/inbound-routing.ts`. The Edge
 * Worker (`workers/inbound-email/src/index.ts`) carries a duplicate
 * copy of `decodeLeadsToken` for early-drop of bogus tokens before
 * the Pages round-trip — the two implementations MUST stay byte-
 * compatible. Anything that would break the wire format here should
 * be mirrored over there.
 */

const SECRET = 'unit-test-secret-do-not-reuse-anywhere-real';
const LEAD_ID = '11111111-1111-1111-1111-111111111111';
const AGENT_ID = '22222222-2222-2222-2222-222222222222';
const LISTING_ID = '33333333-3333-3333-3333-333333333333';

describe('encodeLeadsToken + decodeLeadsToken round-trip', () => {
  it('returns the same payload after a round-trip (with listing_id)', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      listing_id: LISTING_ID,
      secret: SECRET,
    });
    const decoded = await decodeLeadsToken(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded?.lead_id).toBe(LEAD_ID);
    expect(decoded?.agent_id).toBe(AGENT_ID);
    expect(decoded?.listing_id).toBe(LISTING_ID);
  });

  it('returns the same payload after a round-trip (without listing_id)', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
    });
    const decoded = await decodeLeadsToken(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded?.lead_id).toBe(LEAD_ID);
    expect(decoded?.agent_id).toBe(AGENT_ID);
    expect(decoded?.listing_id).toBeUndefined();
  });

  it('produces an URL-safe base64 token (no +, /, =, or whitespace)', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
    });
    // local-part must remain RFC-5321 safe for use as
    // leads+<token>@reply.advertisehomes.online
    expect(token).toMatch(/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/);
  });
});

describe('decodeLeadsToken — failure modes return null', () => {
  it('decodes to null with the wrong secret', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
    });
    const decoded = await decodeLeadsToken(token, 'a-completely-different-secret');
    expect(decoded).toBeNull();
  });

  it('decodes to null when the payload is tampered (sig stays the same)', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
    });
    const [payload, sig] = token.split('.');
    // Flip a single character in the payload — sig no longer matches.
    expect(payload).toBeDefined();
    const tamperedPayload =
      payload!.slice(0, -1) + (payload!.slice(-1) === 'A' ? 'B' : 'A');
    const tampered = `${tamperedPayload}.${sig}`;
    const decoded = await decodeLeadsToken(tampered, SECRET);
    expect(decoded).toBeNull();
  });

  it('decodes to null when the signature is tampered', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
    });
    const [payload, sig] = token.split('.');
    expect(sig).toBeDefined();
    const tamperedSig = sig!.slice(0, -1) + (sig!.slice(-1) === 'A' ? 'B' : 'A');
    const decoded = await decodeLeadsToken(`${payload}.${tamperedSig}`, SECRET);
    expect(decoded).toBeNull();
  });

  it('decodes to null on a malformed token (missing dot separator)', async () => {
    const decoded = await decodeLeadsToken('not-a-valid-token', SECRET);
    expect(decoded).toBeNull();
  });

  it('decodes to null on an empty token', async () => {
    const decoded = await decodeLeadsToken('', SECRET);
    expect(decoded).toBeNull();
  });

  it('decodes to null when the secret is empty', async () => {
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
    });
    const decoded = await decodeLeadsToken(token, '');
    expect(decoded).toBeNull();
  });

  it('decodes to null when the token is older than 90 days', async () => {
    const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
      issuedAt: ninetyOneDaysAgo,
    });
    const decoded = await decodeLeadsToken(token, SECRET);
    expect(decoded).toBeNull();
  });

  it('still decodes a token issued just under the 90-day window', async () => {
    const justInWindow = Date.now() - (90 * 24 * 60 * 60 * 1000 - 60_000); // 90d - 1min
    const token = await encodeLeadsToken({
      lead_id: LEAD_ID,
      agent_id: AGENT_ID,
      secret: SECRET,
      issuedAt: justInWindow,
    });
    const decoded = await decodeLeadsToken(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded?.lead_id).toBe(LEAD_ID);
  });
});

describe('parseLocalPart', () => {
  it('routes leads+<token> to kind=token', () => {
    expect(parseLocalPart('leads+abc123def456')).toEqual({
      kind: 'token',
      token: 'abc123def456',
    });
  });

  it('routes leads+<token> to kind=token even when the token contains dots', () => {
    // The actual HMAC token format is `payload.sig` so the local-part
    // will have a dot inside. RFC 5321 allows dots in the local-part
    // (they're not the standard "+" tag separator).
    expect(parseLocalPart('leads+abc.def')).toEqual({
      kind: 'token',
      token: 'abc.def',
    });
  });

  it('returns kind=unknown for `leads+` with empty token', () => {
    expect(parseLocalPart('leads+')).toEqual({ kind: 'unknown' });
  });

  it('routes a kebab-case slug to kind=slug', () => {
    expect(parseLocalPart('maria-lopez')).toEqual({
      kind: 'slug',
      slug: 'maria-lopez',
    });
  });

  it('lowercases the slug', () => {
    expect(parseLocalPart('Maria-Lopez')).toEqual({
      kind: 'slug',
      slug: 'maria-lopez',
    });
  });

  it('returns kind=unknown for reserved local-parts', () => {
    for (const reserved of [
      'info',
      'admin',
      'postmaster',
      'abuse',
      'noreply',
      'no-reply',
      'mailer-daemon',
      'support',
      'hello',
      'contact',
    ]) {
      expect(parseLocalPart(reserved)).toEqual({ kind: 'unknown' });
      // Case insensitive.
      expect(parseLocalPart(reserved.toUpperCase())).toEqual({ kind: 'unknown' });
    }
  });

  it('returns kind=unknown for slugs that fail the kebab-case regex', () => {
    expect(parseLocalPart('a')).toEqual({ kind: 'unknown' }); // too short
    expect(parseLocalPart('-abc')).toEqual({ kind: 'unknown' }); // leading hyphen
    expect(parseLocalPart('abc-')).toEqual({ kind: 'unknown' }); // trailing hyphen
    expect(parseLocalPart('abc def')).toEqual({ kind: 'unknown' }); // whitespace
    expect(parseLocalPart('abc.def')).toEqual({ kind: 'unknown' }); // dot
    expect(parseLocalPart('abc_def')).toEqual({ kind: 'unknown' }); // underscore
    expect(parseLocalPart('')).toEqual({ kind: 'unknown' });
  });

  it('returns kind=unknown for slugs over the 64-char ceiling', () => {
    const tooLong = 'a' + 'b'.repeat(64) + 'c'; // 66 chars
    expect(parseLocalPart(tooLong)).toEqual({ kind: 'unknown' });
  });
});
