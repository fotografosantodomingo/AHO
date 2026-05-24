import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'edge';

/**
 * POST /api/webhooks/brevo
 *
 * Brevo event webhook — receives delivery / open / click / bounce
 * events for emails sent via /v3/smtp/email. Updates the matching
 * email_messages row by brevo_message_id + bumps the parent
 * email_campaigns counter.
 *
 * Auth: Brevo's webhook UI doesn't sign payloads with a per-request
 * HMAC like Stripe / Tawk. Instead the URL itself carries a secret:
 *   /api/webhooks/brevo?secret=<BREVO_WEBHOOK_SECRET>
 * The handler rejects requests where the query secret doesn't match
 * the env var. This is the same pattern used by the email-campaigns
 * skill's Worker.
 *
 * Payload can be a single event or an array; we accept both.
 *
 * State machine — we never DOWNGRADE a status:
 *   queued → sent → delivered → opened → clicked
 *                 ↓
 *               bounced  (terminal)
 *               failed   (terminal)
 *
 * A late 'sent' event won't overwrite an existing 'opened' row.
 */

const STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  bounced: 5,
  failed: 5,
};

interface BrevoEvent {
  event?: string;
  'message-id'?: string;
  messageId?: string;
  email?: string;
  date?: string;
  ts_event?: number;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const expected = process.env.BREVO_WEBHOOK_SECRET;
  if (!expected) {
    console.error('[brevo webhook] BREVO_WEBHOOK_SECRET not set');
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }
  const provided = new URL(req.url).searchParams.get('secret');
  if (provided !== expected) {
    return NextResponse.json({ error: 'invalid_secret' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const events: BrevoEvent[] = Array.isArray(body)
    ? (body as BrevoEvent[])
    : [body as BrevoEvent];

  const admin = createAdminClient();
  let applied = 0;
  let skipped = 0;
  for (const ev of events) {
    const messageId = ev['message-id'] ?? ev.messageId;
    if (!messageId) {
      skipped += 1;
      continue;
    }
    const eventType = (ev.event ?? '').toLowerCase();
    const mapped = mapBrevoEvent(eventType);
    if (!mapped) {
      skipped += 1;
      continue;
    }
    const tsIso = ev.date ?? (ev.ts_event ? new Date(ev.ts_event * 1000).toISOString() : new Date().toISOString());

    // Find the row first to compare status ranks (avoid downgrades).
    const { data: existing } = await admin
      .from('email_messages')
      .select('id, campaign_id, status')
      .eq('brevo_message_id', messageId)
      .maybeSingle();
    if (!existing) {
      skipped += 1;
      continue;
    }

    const newRank = STATUS_RANK[mapped.status] ?? 0;
    const oldRank = STATUS_RANK[existing.status as string] ?? 0;
    const update: Record<string, unknown> = {
      [mapped.timestampColumn]: tsIso,
    };
    if (newRank > oldRank) {
      update.status = mapped.status;
    }
    if (mapped.status === 'bounced' && ev.reason) {
      update.bounce_reason = ev.reason.slice(0, 500);
    }
    const { error: applyErr } = await admin
      .from('email_messages')
      .update(update)
      .eq('id', existing.id);
    if (applyErr) {
      console.error('[brevo webhook] email_messages update failed', {
        code: applyErr.code,
        message: applyErr.message,
        details: applyErr.details,
        hint: applyErr.hint,
      });
    }

    // Per-campaign counters live on email_campaigns but we don't
    // increment them from the webhook — the /admin/email surface
    // aggregates from email_messages on render (cheap via the
    // (campaign_id) index). Pre-computing the count from webhook
    // events drifts under partial-failure replay; recomputing on
    // read is the lazy-correct alternative.

    applied += 1;
  }

  return NextResponse.json({ ok: true, applied, skipped });
}

interface MappedEvent {
  status: string;
  timestampColumn: string;
  counterColumn?: string;
}

function mapBrevoEvent(brevoType: string): MappedEvent | null {
  switch (brevoType) {
    case 'request':
    case 'sent':
      return { status: 'sent', timestampColumn: 'sent_at' };
    case 'delivered':
      return {
        status: 'delivered',
        timestampColumn: 'delivered_at',
        counterColumn: 'delivered_count',
      };
    case 'opened':
    case 'unique_opened':
      return {
        status: 'opened',
        timestampColumn: 'opened_at',
        counterColumn: 'opened_count',
      };
    case 'click':
      return {
        status: 'clicked',
        timestampColumn: 'clicked_at',
        counterColumn: 'clicked_count',
      };
    case 'hard_bounce':
    case 'soft_bounce':
    case 'blocked':
    case 'spam':
    case 'invalid_email':
    case 'deferred':
    case 'error':
      return {
        status: 'bounced',
        timestampColumn: 'bounced_at',
        counterColumn: 'bounced_count',
      };
    case 'unsubscribed':
      // The bookkeeping happens in our own unsubscribe handler; here
      // we just bump the campaign counter.
      return {
        status: 'sent', // don't downgrade
        timestampColumn: 'sent_at',
        counterColumn: 'unsubscribed_count',
      };
    default:
      return null;
  }
}
