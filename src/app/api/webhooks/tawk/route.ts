import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/webhooks/tawk — Tawk.to webhook entry point.
 *
 * Tawk delivers webhook events for chat:start, chat:end, and
 * ticket:create. The handler:
 *
 *   1. HMAC-SHA1 verifies the raw body against `TAWK_WEBHOOK_SECRET`
 *      using the `X-Tawk-Signature` header (hex digest). Mismatch → 401.
 *   2. Dedups against the `tawk_events_processed` table. Repeat
 *      deliveries return 200 ok-deduped without side effects.
 *   3. Logs a payload summary to the dedup row for later auditing
 *      (visitor email + first message + transcript length, NOT the
 *      full transcript — that would balloon the row).
 *   4. Returns 200 fast. Tawk's retry policy is non-2xx → exponential
 *      backoff; we return 5xx ONLY on environmental failures (missing
 *      secret, dedup table unavailable) so transient retries are
 *      meaningful.
 *
 * No leads-table integration yet (2026-05-14). The existing `leads`
 * schema requires property_id + org_id NOT NULL and the source check
 * doesn't include 'chat'. Once we have real chat traffic + a clear
 * product decision on what to persist, we'll add either a schema
 * change or a separate `chat_threads` table. For now, the dedup
 * table IS the persistence — sufficient to confirm Tawk → AHO
 * round-trip works.
 *
 * Excluded from the i18n middleware via the matcher in
 * `src/middleware.ts` (the `api/` exclusion covers all webhook routes).
 */
export async function POST(req: NextRequest) {
  const { TAWK_WEBHOOK_SECRET } = serverEnv();
  if (!TAWK_WEBHOOK_SECRET) {
    console.error('[tawk webhook] TAWK_WEBHOOK_SECRET not set in env');
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 },
    );
  }

  const signature = req.headers.get('x-tawk-signature');
  if (!signature) {
    return NextResponse.json({ error: 'missing_signature' }, { status: 400 });
  }

  // Tawk signs the raw bytes — read .text() before .json().
  const rawBody = await req.text();

  const valid = await verifyTawkSignature({
    rawBody,
    signature,
    secret: TAWK_WEBHOOK_SECRET,
  });
  if (!valid) {
    console.error('[tawk webhook] signature mismatch');
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: TawkWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as TawkWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const eventId = buildEventId(payload);
  if (!eventId) {
    // Unknown event shape; ack 200 so Tawk stops retrying. Logged for
    // post-hoc investigation.
    console.warn('[tawk webhook] unknown event shape', payload.event);
    return NextResponse.json({ ok: true, ignored: 'unknown_event' });
  }

  const supabase = createAdminClient();
  const summary = buildPayloadSummary(payload);

  const { error: dedupError } = await supabase
    .from('tawk_events_processed')
    .insert({
      event_id: eventId,
      event_type: payload.event ?? 'unknown',
      chat_id: payload.chatId ?? null,
      property_id_external: payload.property?.id ?? null,
      payload_summary: summary,
    });

  if (dedupError) {
    // Postgres unique_violation = 23505 → already processed.
    if (dedupError.code === '23505') {
      return NextResponse.json({ ok: true, deduped: true });
    }
    console.error('[tawk webhook] dedup insert failed', dedupError);
    // 5xx so Tawk retries — likely a transient infra issue.
    return NextResponse.json({ error: 'dedup_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId });
}

interface TawkWebhookPayload {
  event?: string;
  chatId?: string;
  time?: string;
  property?: { id?: string; name?: string };
  visitor?: { name?: string; email?: string; city?: string; country?: string };
  message?: { text?: string; type?: string };
  messages?: Array<{ msg?: string; sender?: { type?: string } }>;
  ticket?: { id?: string; subject?: string };
}

/**
 * Build a deterministic dedup key. Different Tawk events have
 * different stable identifiers:
 *   - chat:start / chat:end → `${event}:${chatId}`
 *   - ticket:create         → `ticket:create:${ticket.id}`
 */
function buildEventId(p: TawkWebhookPayload): string | null {
  if (!p.event) return null;
  if (p.event.startsWith('chat:') && p.chatId) {
    return `${p.event}:${p.chatId}`;
  }
  if (p.event === 'ticket:create' && p.ticket?.id) {
    return `ticket:create:${p.ticket.id}`;
  }
  return null;
}

/**
 * Compact summary stored in the dedup row. Keep small — full
 * transcripts can be 100+ messages. We capture identification +
 * counts, not content.
 */
function buildPayloadSummary(p: TawkWebhookPayload): Record<string, unknown> {
  return {
    event: p.event ?? null,
    time: p.time ?? null,
    visitor: p.visitor
      ? {
          name: p.visitor.name ?? null,
          email: p.visitor.email ?? null,
          city: p.visitor.city ?? null,
          country: p.visitor.country ?? null,
        }
      : null,
    message_text:
      typeof p.message?.text === 'string' ? p.message.text.slice(0, 500) : null,
    message_count: Array.isArray(p.messages) ? p.messages.length : 0,
    ticket_id: p.ticket?.id ?? null,
    ticket_subject: p.ticket?.subject ?? null,
  };
}

/**
 * HMAC-SHA1 verification. Tawk computes `HMAC-SHA1(body, secret)` and
 * sends the hex digest in `X-Tawk-Signature`. Constant-time compare
 * via crypto.subtle (verify-then-equal pattern, since Web Crypto
 * doesn't expose timingSafeEqual on Edge).
 */
async function verifyTawkSignature({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(rawBody),
  );
  const expectedHex = bufferToHex(sigBytes);
  return constantTimeEqualHex(signature.trim().toLowerCase(), expectedHex);
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
