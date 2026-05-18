/**
 * AHO — inbound-email routing helpers.
 *
 * The AHO AI customer-service agent exposes TWO classes of inbound
 * email address (per `docs/AI_AGENT_PLAN.md` §D8 = A):
 *
 *   1. Human-facing per-agent address: `<agent-slug>@reply.advertisehomes.online`
 *      Used on the agent's business card / public profile. Stable.
 *
 *   2. Machine-only opaque `Reply-To` on AI sends:
 *      `leads+<token>@reply.advertisehomes.online`
 *      The `<token>` is an HMAC-signed JSON payload carrying the
 *      routing key `{lead_id, agent_id, listing_id?}` plus an
 *      `issued_at` timestamp for a 90-day TTL. Unguessable, scoped
 *      per-conversation, revocable (rotate the secret to invalidate
 *      every outstanding token).
 *
 * Wire format (must stay in sync with workers/inbound-email/src/index.ts):
 *
 *     <base64url(JSON.stringify(payload))> "." <base64url(HMAC-SHA256(payload))>
 *
 * `payload` shape:
 *
 *     {
 *       lead_id:      "<uuid>",
 *       agent_id:     "<uuid>",
 *       listing_id?:  "<uuid>",
 *       issued_at:    <unix ms>
 *     }
 *
 * Why HMAC instead of an encrypted blob: the routing key is not
 * sensitive (a buyer who has the address already knows the
 * conversation exists), only forgery-protected. HMAC keeps the
 * encoder + decoder small + Edge-runtime-safe.
 *
 * Edge-runtime safe — uses Web Crypto subtle. No Node builtins.
 * Same primitive as `src/lib/oauth/state.ts` + `src/lib/email/unsubscribe.ts`.
 */

const LEADS_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const enc = new TextEncoder();

export interface LeadsTokenPayload {
  lead_id: string;
  agent_id: string;
  listing_id?: string;
}

interface LeadsTokenPayloadOnWire extends LeadsTokenPayload {
  issued_at: number; // unix ms
}

/** Reserved local-parts that must NEVER route to AI. */
const RESERVED_LOCAL_PARTS = new Set([
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
]);

/**
 * Encode a routing payload into the `leads+<token>` local-part
 * format. Caller is responsible for prepending `leads+` and
 * appending `@reply.advertisehomes.online`.
 *
 * Idempotent under {lead_id, agent_id, listing_id} but NOT under
 * `issued_at` — two calls in succession produce different tokens
 * even for the same payload because the timestamp differs. Don't
 * use this as a memoization key.
 */
export async function encodeLeadsToken(args: {
  lead_id: string;
  agent_id: string;
  listing_id?: string;
  secret: string;
  /** Override the issued_at timestamp — for unit testing. */
  issuedAt?: number;
}): Promise<string> {
  if (!args.secret) throw new Error('encodeLeadsToken: secret required');
  if (!args.lead_id) throw new Error('encodeLeadsToken: lead_id required');
  if (!args.agent_id) throw new Error('encodeLeadsToken: agent_id required');

  const payload: LeadsTokenPayloadOnWire = {
    lead_id: args.lead_id,
    agent_id: args.agent_id,
    ...(args.listing_id ? { listing_id: args.listing_id } : {}),
    issued_at: args.issuedAt ?? Date.now(),
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = enc.encode(payloadJson);

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(args.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);

  return `${toBase64Url(payloadBytes.buffer as ArrayBuffer)}.${toBase64Url(sig)}`;
}

/**
 * Decode a `leads+<token>` token. Returns the routing payload on
 * success, or `null` on any failure mode (tampered signature,
 * expired, malformed). NEVER throws on bad input — callers can
 * treat null as "drop this email".
 */
export async function decodeLeadsToken(
  token: string,
  secret: string,
): Promise<LeadsTokenPayload | null> {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = fromBase64Url(parts[0]);
    sigBytes = fromBase64Url(parts[1]);
  } catch {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes as BufferSource,
    payloadBytes as BufferSource,
  );
  if (!ok) return null;

  let payload: LeadsTokenPayloadOnWire;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LeadsTokenPayloadOnWire;
  } catch {
    return null;
  }

  if (typeof payload.issued_at !== 'number') return null;
  if (Date.now() - payload.issued_at > LEADS_TOKEN_TTL_MS) return null;
  if (!payload.lead_id || !payload.agent_id) return null;

  const out: LeadsTokenPayload = {
    lead_id: payload.lead_id,
    agent_id: payload.agent_id,
  };
  if (payload.listing_id) out.listing_id = payload.listing_id;
  return out;
}

export type ParsedLocalPart =
  | { kind: 'token'; token: string }
  | { kind: 'slug'; slug: string }
  | { kind: 'unknown' };

/**
 * Classify the local-part of an inbound-email recipient address.
 *
 *   `leads+<token>`  → { kind: 'token', token }
 *   `<agent-slug>`   → { kind: 'slug', slug }    (lowercased)
 *   anything else    → { kind: 'unknown' }
 *
 * Pure function — no DB lookups, no HMAC verify. The caller decides
 * how to act on the result (`decodeLeadsToken` for tokens; org
 * lookup for slugs).
 */
export function parseLocalPart(localPart: string): ParsedLocalPart {
  if (!localPart) return { kind: 'unknown' };
  const lower = localPart.toLowerCase();

  if (RESERVED_LOCAL_PARTS.has(lower)) return { kind: 'unknown' };

  if (lower.startsWith('leads+')) {
    const token = localPart.slice('leads+'.length);
    if (!token) return { kind: 'unknown' };
    return { kind: 'token', token };
  }

  // Kebab-case ASCII slug. Mirror the slug rules in
  // src/lib/listings/seo.ts: lowercase letters/digits with hyphens,
  // 3-64 chars, must start + end alphanumeric.
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(lower)) return { kind: 'unknown' };
  return { kind: 'slug', slug: lower };
}

// ─── base64url helpers (Edge-runtime safe) ────────────────────────

function toBase64Url(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i] as number);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 =
    b64url.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
