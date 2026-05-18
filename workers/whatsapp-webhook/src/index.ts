/**
 * AHO — WhatsApp webhook receiver.
 *
 * Phase 4 of docs/AI_AGENT_PLAN.md. The public HTTPS endpoint that
 * 360dialog (D3=A) — or Twilio for WhatsApp (R5 documented fallback)
 * — calls with two payload shapes:
 *
 *   1. Inbound message  → parsed + forwarded to
 *                          ${AHO_API_BASE}/api/inbound/whatsapp
 *   2. Status callback   → parsed + forwarded to
 *                          ${AHO_API_BASE}/api/inbound/whatsapp/status
 *
 * Why a thin Worker proxy instead of routing 360dialog straight to
 * the Pages app: the Worker is the trust boundary for the WhatsApp
 * Business Platform signature (X-Hub-Signature-256 / HMAC-SHA256).
 * The Pages app authenticates the FORWARD via a shared HMAC bearer
 * (INBOUND_SECRET), so a Pages route never has to know the Meta
 * signing secret. This mirrors workers/audit-prune (proxy pattern)
 * and workers/saved-search-alerts (HTTP-only Worker).
 *
 * Signature scheme (Meta-compatible, identical to the FB Graph
 * webhook contract):
 *
 *   X-Hub-Signature-256: sha256=<hex>
 *
 * where `<hex>` is HMAC-SHA256(rawBody, WHATSAPP_WEBHOOK_SECRET)
 * encoded as lowercase hex. Compared constant-time below.
 *
 * Payload shape (Meta WhatsApp Business Cloud API; 360dialog mirrors
 * verbatim):
 *
 *   {
 *     "object": "whatsapp_business_account",
 *     "entry": [{
 *       "id": "<waba_id>",
 *       "changes": [{
 *         "field": "messages",
 *         "value": {
 *           "messaging_product": "whatsapp",
 *           "metadata": {
 *             "display_phone_number": "+1...",
 *             "phone_number_id": "<meta_phone_id>"
 *           },
 *           "messages":   [...]   // inbound; absent on status pushes
 *           "statuses":   [...]   // status; absent on inbound pushes
 *           "contacts":   [...]   // inbound only; profile name
 *         }
 *       }]
 *     }]
 *   }
 *
 * We DO NOT resolve the wa_number_id from a DB lookup here — the
 * Worker stays stateless. The Pages route owns that mapping
 * (whatsapp_numbers.meta_phone_id → wa_number_id) so we don't
 * duplicate Supabase wiring on two sides of the trust boundary.
 *
 * Always returns 200. Meta retries aggressively on non-2xx (every
 * 30s for up to 7 days), so failure-mode is "log + drop" rather
 * than "fail loud and create a retry storm".
 */

interface Env {
  /** Shared with 360dialog (or Meta Cloud API direct). Signs the
   *  webhook body via HMAC-SHA256. NEVER exposed to the Pages app. */
  WHATSAPP_WEBHOOK_SECRET: string;
  /** Shared with the AHO Pages app. Bearer token on the forwarded
   *  POST so the /api/inbound/whatsapp(/status) routes can
   *  authenticate the Worker without user-session context. */
  INBOUND_SECRET: string;
  /** Base URL of the Pages app. https://advertisehomes.online in
   *  prod; the *.aho-web.pages.dev subdomain in preview. */
  AHO_API_BASE: string;
  LOG_LEVEL: string;
}

interface MetaInboundMessage {
  from: string;             // E.164 with no '+' (Meta convention)
  id: string;               // wamid.xxx
  timestamp: string;        // unix seconds as string
  type: string;             // 'text' | 'image' | 'audio' | 'document' | ...
  text?: { body: string };
  image?: { id: string; mime_type?: string; caption?: string };
  audio?: { id: string; mime_type?: string };
  document?: { id: string; filename?: string; mime_type?: string; caption?: string };
  video?: { id: string; mime_type?: string; caption?: string };
  location?: { latitude: number; longitude: number; name?: string };
  context?: { from?: string; id?: string };  // reply-to chain
}

interface MetaStatusUpdate {
  id: string;               // wamid.xxx of the outbound being acked
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;     // buyer phone (no '+')
  conversation?: { id: string; origin?: { type: string } };
  pricing?: { billable: boolean; pricing_model: string; category: string };
  errors?: Array<{ code: number; title: string; message?: string }>;
}

interface MetaWebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: MetaInboundMessage[];
  statuses?: MetaStatusUpdate[];
}

interface MetaWebhookEntry {
  id: string;               // waba_id
  changes: Array<{ field: string; value: MetaWebhookValue }>;
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Meta verification handshake. When 360dialog / Meta first
    // registers the webhook, it does a GET with hub.mode=subscribe
    // and a verify-token. We echo hub.challenge back if the token
    // matches WHATSAPP_WEBHOOK_SECRET. Required by the platform;
    // documented at developers.facebook.com/docs/whatsapp/cloud-api/
    // guides/set-up-webhooks#step-1-register-the-webhook.
    if (req.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (
        mode === 'subscribe' &&
        token &&
        env.WHATSAPP_WEBHOOK_SECRET &&
        token === env.WHATSAPP_WEBHOOK_SECRET
      ) {
        return new Response(challenge ?? '', { status: 200 });
      }
      return new Response('forbidden', { status: 403 });
    }

    if (req.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }

    // Read raw body BEFORE JSON.parse — signature is computed over
    // the exact bytes Meta sent. Anything that touches the body
    // (req.json(), URL-encoding, whitespace normalisation) breaks
    // the digest.
    const rawBody = await req.text();
    const signatureHeader = req.headers.get('x-hub-signature-256') ?? '';

    if (!env.WHATSAPP_WEBHOOK_SECRET) {
      console.error('[whatsapp-webhook] WHATSAPP_WEBHOOK_SECRET unset; cannot verify');
      // 200 so Meta doesn't retry; alert via wrangler tail.
      return new Response('ok', { status: 200 });
    }

    const sigValid = await verifyMetaSignature({
      rawBody,
      signatureHeader,
      secret: env.WHATSAPP_WEBHOOK_SECRET,
    });
    if (!sigValid) {
      console.error('[whatsapp-webhook] signature mismatch; dropping');
      // 200 + drop is intentional. A 401 would loop Meta's retry
      // for 7 days and pollute their dashboard; we'd rather log +
      // alert on our side.
      return new Response('ok', { status: 200 });
    }

    let payload: MetaWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as MetaWebhookPayload;
    } catch (err) {
      console.error('[whatsapp-webhook] invalid JSON', err);
      return new Response('ok', { status: 200 });
    }

    // Schedule the forwards via waitUntil so we return 200 fast
    // (Meta's median timeout is 5s; we cap real work outside the
    // critical path). Each forward is independently awaited inside
    // the promise so a failed delivery callback doesn't drop a
    // sibling inbound message.
    ctx.waitUntil(processPayload(payload, env));

    return new Response('ok', { status: 200 });
  },
};

async function processPayload(
  payload: MetaWebhookPayload,
  env: Env,
): Promise<void> {
  const entries = payload.entry ?? [];
  for (const entry of entries) {
    const wabaId = entry.id;
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      const displayPhone = value.metadata?.display_phone_number ?? null;

      // ─── Inbound messages ──────────────────────────────────────
      for (const msg of value.messages ?? []) {
        const contact = (value.contacts ?? []).find((c) => c.wa_id === msg.from);
        try {
          await forwardInbound(env, {
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
            display_phone_number: displayPhone,
            from_e164: normalizeE164(msg.from),
            buyer_profile_name: contact?.profile?.name ?? null,
            message: msg,
          });
        } catch (err) {
          console.error('[whatsapp-webhook] forwardInbound failed', {
            wa_message_id: msg.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // ─── Status callbacks ──────────────────────────────────────
      for (const st of value.statuses ?? []) {
        try {
          await forwardStatus(env, {
            wa_message_id: st.id,
            status: st.status,
            timestamp: st.timestamp,
            recipient_e164: normalizeE164(st.recipient_id),
            error_code: st.errors?.[0]?.code ?? null,
            error_message: st.errors?.[0]?.message ?? st.errors?.[0]?.title ?? null,
          });
        } catch (err) {
          console.error('[whatsapp-webhook] forwardStatus failed', {
            wa_message_id: st.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }
}

/**
 * POST the inbound message to the Pages app. The Pages route owns
 * the meta_phone_id → wa_number_id mapping + the conversation
 * router; this Worker stays stateless.
 */
async function forwardInbound(
  env: Env,
  body: Record<string, unknown>,
): Promise<void> {
  const url = new URL('/api/inbound/whatsapp', env.AHO_API_BASE).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INBOUND_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[whatsapp-webhook] /api/inbound/whatsapp non-2xx', {
      status: res.status,
      body: text.slice(0, 500),
    });
  }
}

async function forwardStatus(
  env: Env,
  body: Record<string, unknown>,
): Promise<void> {
  const url = new URL('/api/inbound/whatsapp/status', env.AHO_API_BASE).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INBOUND_SECRET}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[whatsapp-webhook] /api/inbound/whatsapp/status non-2xx', {
      status: res.status,
      body: text.slice(0, 500),
    });
  }
}

/**
 * Meta sends phone numbers as digits without a leading '+'. AHO's
 * leads schema (migration 0009) stores E.164 with the '+'. Normalize
 * here before crossing the trust boundary so the Pages route doesn't
 * have to guess.
 */
function normalizeE164(raw: string): string {
  if (!raw) return raw;
  return raw.startsWith('+') ? raw : `+${raw}`;
}

/**
 * Constant-time verify the X-Hub-Signature-256 header.
 *
 *   header   = "sha256=<hex>"
 *   expected = HMAC-SHA256(rawBody, secret) in lowercase hex
 *
 * Pattern mirrors src/app/api/webhooks/tawk/route.ts (SHA-1 there;
 * SHA-256 here per Meta's spec) and src/app/api/oauth/meta/
 * deauthorize/route.ts (which already verifies a similar Meta-style
 * signed-request body, just SHA-256 base64url instead of hex).
 */
async function verifyMetaSignature(args: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
}): Promise<boolean> {
  const prefix = 'sha256=';
  if (!args.signatureHeader.startsWith(prefix)) return false;
  const provided = args.signatureHeader.slice(prefix.length).trim().toLowerCase();

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(args.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(args.rawBody));
  const expectedHex = bufferToHex(sigBytes);

  return constantTimeEqualHex(provided, expectedHex);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
