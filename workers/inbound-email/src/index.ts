/**
 * AHO — inbound-email Email Worker.
 *
 * Cloudflare Email Routing → this Worker's `email()` handler → parse +
 * verify auth + route by local-part → POST a parsed payload to
 * /api/inbound/email on the Pages app. The Pages route does all the
 * DB writes; this Worker is a thin trust-boundary parser.
 *
 * Trust model:
 *   - The Worker runs inside Cloudflare's email pipeline. The
 *     `Authentication-Results` header is set by Cloudflare's own
 *     verifier (not the sender) — we trust it.
 *   - DMARC fail → drop the email silently (no bounce). Bouncing
 *     would leak that the address exists to a spammer.
 *   - The Worker authenticates to the Pages route with a shared
 *     bearer secret (`INBOUND_SECRET`); the Pages route refuses
 *     anything else.
 *
 * Phase 3 of docs/AI_AGENT_PLAN.md. PO action wires up DNS + CF
 * Email Routing separately — see README.md.
 */

import PostalMime, { type Email } from 'postal-mime';

interface Env {
  /** Shared bearer secret. Must match `INBOUND_EMAIL_SECRET` on the AHO Pages env. */
  INBOUND_SECRET: string;
  /** Base URL of the AHO Pages app, e.g. `https://advertisehomes.online`. */
  AHO_API_BASE: string;
  /** HMAC key used to decode `leads+<base64url(payload+sig)>` local-parts. */
  LEADS_TOKEN_SECRET: string;
  LOG_LEVEL: string;
}

type AuthVerdict = 'pass' | 'fail' | 'neutral' | 'unknown';

interface AuthResults {
  dmarc: AuthVerdict;
  dkim: AuthVerdict;
  spf: AuthVerdict;
}

/** Decoded routing payload for leads+<token>@... addresses. */
interface LeadsRoutePayload {
  kind: 'leads_token';
  lead_id: string;
  agent_id: string;
  listing_id?: string;
}

interface SlugRoutePayload {
  kind: 'agent_slug';
  slug: string;
}

type RoutePayload = LeadsRoutePayload | SlugRoutePayload;

/**
 * Cloudflare Email Worker entrypoint. The runtime invokes `email()`
 * for every message routed by Cloudflare Email Routing to this Worker.
 */
export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      await handleEmail(message, env, ctx);
    } catch (err) {
      // Top-level safety net. We never want to 5xx out of the email
      // handler — Cloudflare interprets handler throws as deferred /
      // bounced delivery, which leaks the address.
      console.error('[aho-inbound-email] uncaught', {
        from: message.from,
        to: message.to,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
} satisfies ExportedHandler<Env>;

async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  // 1. Parse the message body. postal-mime works on a Node-style stream
  //    Reader; ForwardableEmailMessage.raw is a ReadableStream<Uint8Array>.
  const raw = await new Response(message.raw).arrayBuffer();
  const parser = new PostalMime();
  const parsed: Email = await parser.parse(raw);

  // 2. Verify DKIM/SPF/DMARC from the Cloudflare-set Authentication-Results
  //    header. We treat the absence of the header as `unknown` (don't trust
  //    but don't auto-drop) — Cloudflare always sets it in practice, so an
  //    empty value is a config issue, not a forged email.
  const auth = parseAuthResults(message.headers.get('Authentication-Results') ?? '');

  if (auth.dmarc === 'fail') {
    console.error('[aho-inbound-email] dmarc_fail drop', {
      from: message.from,
      to: message.to,
      authResults: message.headers.get('Authentication-Results') ?? '(missing)',
    });
    return;
  }

  // 3. Local-part routing. Cloudflare's catch-all on
  //    reply.advertisehomes.online delivers EVERYTHING to this Worker;
  //    we do the dispatch.
  const recipient = message.to;
  const at = recipient.lastIndexOf('@');
  const localPart = at >= 0 ? recipient.slice(0, at) : recipient;

  const route = await resolveRoute(localPart, env);
  if (!route) {
    console.error('[aho-inbound-email] unknown_local_part drop', {
      from: message.from,
      to: recipient,
      localPart,
    });
    return;
  }

  // 4. Per-sender rate limit. v1 lets everything through; the DO-backed
  //    counter goes in once Workers Paid + DO storage is provisioned.
  // TODO: DO-backed rate limiter, 10 msgs/min/sender. When a sender
  //       exceeds, log + drop (do not bounce — that would tell them).

  // 5. Forward to the Pages app. The route does the DB writes + kicks
  //    off the async AI-draft handoff.
  const apiUrl = new URL('/api/inbound/email', env.AHO_API_BASE).toString();
  const body = {
    parsed,
    route,
    auth,
    // Convenience copies — the Pages route could derive these from
    // parsed.headers, but emitting them at the top level shortens the
    // critical path on the server.
    envelope: {
      from: message.from,
      to: recipient,
    },
  };

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.INBOUND_SECRET}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error('[aho-inbound-email] api_fetch_failed', {
      url: apiUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!res.ok) {
    // Log but do not bounce. Pages-side retries will be handled by a
    // future queue once we wire one up; for now a 500 from the Pages
    // route is just a logged drop.
    const text = await res.text().catch(() => '');
    console.error('[aho-inbound-email] api_non_2xx', {
      status: res.status,
      body: text.slice(0, 500),
    });
    return;
  }

  console.error('[aho-inbound-email] ok', {
    from: message.from,
    to: recipient,
    routeKind: route.kind,
  });
}

/**
 * Parses the Authentication-Results header into a triple of verdicts.
 * Format is RFC 8601: `mx.cloudflare.net; dkim=pass header.d=...; spf=pass smtp.mailfrom=...; dmarc=pass action=none`.
 * Order isn't guaranteed; multiple methods can appear.
 */
function parseAuthResults(header: string): AuthResults {
  const lower = header.toLowerCase();
  const verdict = (method: 'dkim' | 'spf' | 'dmarc'): AuthVerdict => {
    // Match e.g. "dkim=pass" / "dkim=fail" / "dkim=neutral".
    const re = new RegExp(`\\b${method}\\s*=\\s*(pass|fail|neutral|softfail|none|temperror|permerror)\\b`);
    const m = lower.match(re);
    if (!m) return 'unknown';
    const v = m[1];
    if (v === 'pass') return 'pass';
    if (v === 'fail' || v === 'permerror') return 'fail';
    return 'neutral';
  };
  return {
    dmarc: verdict('dmarc'),
    dkim: verdict('dkim'),
    spf: verdict('spf'),
  };
}

/**
 * Resolves the local-part to a routing payload. Three cases:
 *   - `leads+<token>` — HMAC-signed opaque token; decode to get
 *     {lead_id, agent_id, listing_id?}.
 *   - `<agent-slug>` — human-facing per-agent address.
 *   - anything else (info / admin / postmaster / random) — drop.
 *
 * Reserved / well-known local-parts that should never be AI-routed:
 *   info, admin, postmaster, abuse, noreply, no-reply, mailer-daemon.
 */
async function resolveRoute(localPart: string, env: Env): Promise<RoutePayload | null> {
  const lower = localPart.toLowerCase();

  const RESERVED = new Set([
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
  if (RESERVED.has(lower)) return null;

  if (lower.startsWith('leads+')) {
    const token = localPart.slice('leads+'.length);
    const decoded = await decodeLeadsToken(token, env.LEADS_TOKEN_SECRET);
    if (!decoded) return null;
    return {
      kind: 'leads_token',
      lead_id: decoded.lead_id,
      agent_id: decoded.agent_id,
      ...(decoded.listing_id ? { listing_id: decoded.listing_id } : {}),
    };
  }

  // Agent-slug fallback. Slugs are kebab-case ASCII (a-z 0-9 -) per
  // src/lib/listings/seo.ts; refuse anything else.
  if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(lower)) return null;
  return { kind: 'agent_slug', slug: lower };
}

// ──────────────────────────────────────────────────────────────────
// Worker-local copy of decodeLeadsToken.
//
// The canonical implementation lives at
// `src/lib/email/inbound-routing.ts` on the AHO Pages side; we
// duplicate the decoder here so the Worker can drop bogus tokens
// before paying the AHO API round-trip. The signing format is
// stable + simple (HMAC-SHA256 over a JSON payload, base64url-
// encoded `payload.sig`) so the duplication is cheap.
//
// Keep this byte-compatible with src/lib/email/inbound-routing.ts
// — they MUST agree on the wire format.
// ──────────────────────────────────────────────────────────────────

interface DecodedLeadsPayload {
  lead_id: string;
  agent_id: string;
  listing_id?: string;
  issued_at: number; // unix ms
}

const LEADS_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const enc = new TextEncoder();

async function decodeLeadsToken(token: string, secret: string): Promise<DecodedLeadsPayload | null> {
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

  let payload: DecodedLeadsPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as DecodedLeadsPayload;
  } catch {
    return null;
  }

  if (typeof payload.issued_at !== 'number') return null;
  if (Date.now() - payload.issued_at > LEADS_TOKEN_TTL_MS) return null;
  if (!payload.lead_id || !payload.agent_id) return null;
  return payload;
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
