import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/inbound/whatsapp/status — delivery callbacks from
 * `workers/whatsapp-webhook/`.
 *
 * Body shape (set by the Worker):
 *   {
 *     wa_message_id: string;            // wamid.xxx of the outbound
 *     status: 'sent' | 'delivered' | 'read' | 'failed';
 *     timestamp: string;                // unix seconds as string
 *     recipient_e164: string;
 *     error_code: number | null;
 *     error_message: string | null;
 *   }
 *
 * Auth: same HMAC bearer (`INBOUND_SECRET`) as the inbound route.
 *
 * Behavior:
 *   1. Validate bearer (401 on mismatch).
 *   2. UPDATE whatsapp_messages.delivery_status by wa_message_id.
 *   3. Return 200 always — Meta retries on non-2xx.
 *
 * No-op when wa_message_id doesn't match a known outbound row. This
 * happens during the first hours of going live (callbacks for sends
 * that pre-dated our migration) and for the rare delivery callback
 * Meta replays for a message we've already torn down via cascade
 * delete on the parent conversation.
 *
 * CLAUDE.md gotcha discipline:
 *   - `await` every supabase call + destructure `{ error }`.
 *   - Use console.error so `wrangler pages deployment tail` reliably
 *     shows the line in --format pretty.
 */
export async function POST(req: NextRequest) {
  const { INBOUND_SECRET } = serverEnv();
  if (!INBOUND_SECRET) {
    console.error('[whatsapp status] INBOUND_SECRET not configured');
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 },
    );
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!isValidBearer(auth, INBOUND_SECRET)) {
    console.error('[whatsapp status] bearer mismatch');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: StatusForward;
  try {
    payload = (await req.json()) as StatusForward;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const { wa_message_id, status } = payload;
  if (!wa_message_id || !ALLOWED_STATUSES.has(status)) {
    console.error('[whatsapp status] invalid payload', { wa_message_id, status });
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Update + select the affected rows so we can tell apart an unknown
  // wa_message_id (rare; usually means the message pre-dated our
  // schema or the parent conversation was already torn down) from a
  // real DB failure. supabase-js doesn't throw on row-level errors —
  // we destructure `{ error, data }` explicitly per CLAUDE.md gotcha.
  const { data: updated, error: updateError } = await supabase
    .from('whatsapp_messages')
    .update({ delivery_status: status })
    .eq('wa_message_id', wa_message_id)
    .select('id');

  if (updateError) {
    console.error('[whatsapp status] update failed', {
      code: updateError.code,
      message: updateError.message,
      wa_message_id,
    });
    // 200 — don't trigger Meta's retry storm on our own DB blip.
    return NextResponse.json({ ok: true, dropped: 'db_error' });
  }

  if (!updated || updated.length === 0) {
    console.warn('[whatsapp status] unknown wa_message_id', { wa_message_id });
    return NextResponse.json({ ok: true, dropped: 'unknown_message' });
  }

  return NextResponse.json({ ok: true });
}

const ALLOWED_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

interface StatusForward {
  wa_message_id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_e164: string;
  error_code: number | null;
  error_message: string | null;
}

function isValidBearer(header: string, secret: string): boolean {
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const supplied = header.slice(prefix.length).trim();
  if (supplied.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < supplied.length; i++) {
    mismatch |= supplied.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}
