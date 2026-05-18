import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/inbound/whatsapp — entry point for inbound WhatsApp messages.
 *
 * Called by `workers/whatsapp-webhook/` after that Worker verifies
 * Meta's `X-Hub-Signature-256` HMAC. The Worker → Pages auth is a
 * shared-secret bearer (`INBOUND_SECRET`) so this route never has to
 * know the Meta signing secret.
 *
 * Flow:
 *   1. Validate the `Authorization: Bearer <INBOUND_SECRET>` header;
 *      401 on mismatch / missing.
 *   2. Resolve the agent + org by looking up `whatsapp_numbers` by
 *      the Meta `phone_number_id` (sent in metadata by the Worker).
 *   3. Resolve the buyer: find-or-create a `leads` row keyed on
 *      (org_id, property_id?, buyer_phone). Source = 'whatsapp_click'
 *      to match the existing CHECK constraint in migration 0009.
 *   4. Resolve the conversation: find an open `ai_conversations` row
 *      for (lead_id, agent_id, channel='whatsapp'); insert a new one
 *      otherwise.
 *   5. INSERT `ai_conversation_messages` row (role='user',
 *      channel='whatsapp', body=text).
 *   6. INSERT `whatsapp_messages` twin (direction='inbound',
 *      in_service_window=true — the buyer just messaged us so by
 *      definition the customer-care window is open).
 *   7. Schedule the AI draft asynchronously (stub `scheduleDraft()`
 *      below — same pattern as Phase 3 email). The actual
 *      converse.ts call lands in a Phase 4 polish PR.
 *   8. Return 200.
 *
 * IMPORTANT (CLAUDE.md gotchas):
 *   - Every supabase write `await`s + destructures `{ error }`. The
 *     Edge runtime kills unawaited promises; supabase-js does NOT
 *     throw on row-level errors.
 *   - Returns 200 even on internal failures EXCEPT auth — the Worker
 *     logs failure modes, and the upstream Meta retry storm we want
 *     to avoid is gated at the Worker layer.
 *
 * Body shape (matches what the Worker sends):
 *   {
 *     waba_id: string;
 *     phone_number_id: string | null;
 *     display_phone_number: string | null;
 *     from_e164: string;
 *     buyer_profile_name: string | null;
 *     message: {
 *       id: string;
 *       timestamp: string;
 *       type: string;
 *       text?: { body: string };
 *       image?: { id: string; caption?: string };
 *       ...other media variants
 *     };
 *   }
 */
export async function POST(req: NextRequest) {
  const { INBOUND_SECRET } = serverEnv();
  if (!INBOUND_SECRET) {
    console.error('[whatsapp inbound] INBOUND_SECRET not configured');
    return NextResponse.json(
      { error: 'webhook_not_configured' },
      { status: 503 },
    );
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!isValidBearer(auth, INBOUND_SECRET)) {
    console.error('[whatsapp inbound] bearer mismatch');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: WhatsappInboundForward;
  try {
    payload = (await req.json()) as WhatsappInboundForward;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const phoneNumberId = payload.phone_number_id;
  const fromE164 = payload.from_e164;
  const waMessageId = payload.message?.id;
  if (!phoneNumberId || !fromE164 || !waMessageId) {
    console.error('[whatsapp inbound] missing required fields', {
      phoneNumberId,
      fromE164,
      waMessageId,
    });
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // 1. Resolve the WhatsApp number → agent + org.
  // NOTE: 360dialog provides Meta's `phone_number_id` as the routing
  // key; v1 schema doesn't have that column on whatsapp_numbers yet
  // (Phase 4 polish PR adds it as `meta_phone_id text not null
  // unique`). For now, the BSP wiring stores phone_number_id in
  // bsp_account_id during Embedded Signup. This lookup mirrors the
  // post-polish path so the call site stays stable.
  const { data: waNumber, error: waNumberError } = await supabase
    .from('whatsapp_numbers')
    .select('id, agent_id, org_id, status')
    .eq('bsp_account_id', phoneNumberId)
    .maybeSingle();

  if (waNumberError) {
    console.error('[whatsapp inbound] whatsapp_numbers lookup failed', {
      code: waNumberError.code,
      message: waNumberError.message,
    });
    // 200 — we don't want Meta to retry our own DB blip.
    return NextResponse.json({ ok: true, dropped: 'db_error' });
  }
  if (!waNumber) {
    console.warn('[whatsapp inbound] unknown phone_number_id', { phoneNumberId });
    return NextResponse.json({ ok: true, dropped: 'unknown_number' });
  }
  if (waNumber.status !== 'active') {
    console.warn('[whatsapp inbound] number not active', {
      phoneNumberId,
      status: waNumber.status,
    });
    return NextResponse.json({ ok: true, dropped: 'inactive_number' });
  }

  // 2. Extract the body text (or a placeholder for media-only).
  const body = extractMessageBody(payload.message);

  // 3. Find-or-create the lead. v1 keys on (org_id, contact_phone)
  // since WhatsApp inbound doesn't always carry a property_id;
  // listing context is captured in a future polish PR by parsing
  // the wa.me pre-fill text (see src/lib/whatsapp/wa-link-builder.ts).
  // The leads schema (migration 0009) requires property_id NOT NULL,
  // which means v1 inbound without a property_id reference falls
  // back to a sentinel listing OR delays lead creation. Stub here
  // captures the intent; the property-resolution loop ships with the
  // wa.me listing-context parser in Phase 4 polish.
  const leadId: string | null = null;
  // TODO(phase-4-polish): parse listing_short_id from the inbound
  // text via parseWaListingHint() (src/lib/whatsapp/wa-link-builder.ts);
  // upsert into leads with source='whatsapp_click'.

  // 4. Find-or-create the conversation. v1 keys on
  // (agent_id, buyer_phone, channel='whatsapp', status='open').
  let conversationId: string;
  const { data: existing, error: convQueryError } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('agent_id', waNumber.agent_id)
    .eq('channel', 'whatsapp')
    .eq('buyer_phone', fromE164)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (convQueryError) {
    console.error('[whatsapp inbound] ai_conversations lookup failed', {
      code: convQueryError.code,
      message: convQueryError.message,
    });
    return NextResponse.json({ ok: true, dropped: 'db_error' });
  }
  if (existing) {
    conversationId = existing.id;
    const { error: touchError } = await supabase
      .from('ai_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
    if (touchError) {
      console.error('[whatsapp inbound] ai_conversations touch failed', {
        code: touchError.code,
        message: touchError.message,
      });
    }
  } else {
    const { data: inserted, error: convInsertError } = await supabase
      .from('ai_conversations')
      .insert({
        org_id: waNumber.org_id,
        agent_id: waNumber.agent_id,
        lead_id: leadId,
        channel: 'whatsapp',
        status: 'open',
        // Buyer locale lands in a Phase 4 polish PR via the WhatsApp
        // profile `language` field (Meta passes it on the first
        // inbound). For now default 'en' — agent-prompts.ts will
        // detect the buyer's language from the message itself via
        // its own market routing.
        buyer_locale: 'en',
        buyer_phone: fromE164,
      })
      .select('id')
      .single();
    if (convInsertError || !inserted) {
      console.error('[whatsapp inbound] ai_conversations insert failed', {
        code: convInsertError?.code,
        message: convInsertError?.message,
      });
      return NextResponse.json({ ok: true, dropped: 'db_error' });
    }
    conversationId = inserted.id;
  }

  // 5. Insert the conversation message (channel-agnostic spine).
  const { data: msgInserted, error: msgInsertError } = await supabase
    .from('ai_conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      channel: 'whatsapp',
      body,
      attachments: buildAttachmentsBlob(payload.message),
    })
    .select('id')
    .single();
  if (msgInsertError || !msgInserted) {
    console.error('[whatsapp inbound] ai_conversation_messages insert failed', {
      code: msgInsertError?.code,
      message: msgInsertError?.message,
    });
    return NextResponse.json({ ok: true, dropped: 'db_error' });
  }

  // 6. Insert the WhatsApp twin.
  const { error: waMsgError } = await supabase.from('whatsapp_messages').insert({
    conversation_message_id: msgInserted.id,
    wa_number_id: waNumber.id,
    wa_message_id: waMessageId,
    direction: 'inbound',
    in_service_window: true,
    cost_cents: 0,
    delivery_status: 'delivered',
  });
  if (waMsgError) {
    console.error('[whatsapp inbound] whatsapp_messages insert failed', {
      code: waMsgError.code,
      message: waMsgError.message,
      // 23505 = unique violation = Meta redelivered the same message.
      // Idempotent insert; we ignore duplicates.
    });
    if (waMsgError.code !== '23505') {
      return NextResponse.json({ ok: true, dropped: 'db_error' });
    }
  }

  // 7. Kick off the AI draft asynchronously. The stub keeps the route
  // synchronous + 200-fast; the actual converse.ts call lands in a
  // Phase 4 polish PR alongside the converse → send adapter.
  scheduleDraft({
    conversationId,
    agentId: waNumber.agent_id,
    orgId: waNumber.org_id,
  });

  return NextResponse.json({
    ok: true,
    conversation_id: conversationId,
    message_id: msgInserted.id,
  });
}

/**
 * Phase-4 stub. Same shape as the email-channel scheduleDraft in
 * `/api/inbound/email`. The polish PR replaces this with a queue
 * push (Cloudflare Queues or a Supabase pg_cron-driven worker) so
 * inbound HTTP handlers stay <200 ms p95.
 *
 * Why not just `void converse(...)` here:
 *   - The Edge runtime kills unawaited promises after the response
 *     returns (CLAUDE.md gotcha). We'd lose the draft silently.
 *   - We don't want the inbound webhook to wait on a 2-4s Anthropic
 *     call before acking 200 to the upstream Worker.
 *
 * The fix is `ctx.waitUntil(...)` — but next-on-pages doesn't expose
 * `ctx` cleanly inside route handlers. The Phase 4 polish PR adds a
 * dedicated drafter Worker + queue push; this stub keeps the
 * interface stable so the polish PR is a 1-line swap here.
 */
function scheduleDraft(args: {
  conversationId: string;
  agentId: string;
  orgId: string;
}): void {
  console.log('[whatsapp inbound] scheduleDraft stub', args);
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

interface WhatsappInboundMessage {
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string; mime_type?: string };
  audio?: { id?: string; mime_type?: string };
  video?: { id?: string; caption?: string; mime_type?: string };
  document?: { id?: string; filename?: string; caption?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
  context?: { id?: string; from?: string };
}

interface WhatsappInboundForward {
  waba_id: string;
  phone_number_id: string | null;
  display_phone_number: string | null;
  from_e164: string;
  buyer_profile_name: string | null;
  message: WhatsappInboundMessage;
}

function extractMessageBody(msg: WhatsappInboundMessage): string {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return `[image] ${msg.image.caption}`;
  if (msg.image) return '[image]';
  if (msg.video?.caption) return `[video] ${msg.video.caption}`;
  if (msg.video) return '[video]';
  if (msg.document?.caption) return `[document] ${msg.document.caption}`;
  if (msg.document?.filename) return `[document: ${msg.document.filename}]`;
  if (msg.document) return '[document]';
  if (msg.audio) return '[audio]';
  if (msg.location)
    return `[location ${msg.location.latitude},${msg.location.longitude}]`;
  return `[${msg.type ?? 'unknown'}]`;
}

function buildAttachmentsBlob(
  msg: WhatsappInboundMessage,
): Record<string, unknown> | null {
  if (msg.type === 'text') return null;
  return {
    type: msg.type ?? null,
    media_id:
      msg.image?.id ??
      msg.audio?.id ??
      msg.video?.id ??
      msg.document?.id ??
      null,
    mime_type:
      msg.image?.mime_type ??
      msg.audio?.mime_type ??
      msg.video?.mime_type ??
      msg.document?.mime_type ??
      null,
    filename: msg.document?.filename ?? null,
    location: msg.location ?? null,
    reply_to_wa_message_id: msg.context?.id ?? null,
  };
}
