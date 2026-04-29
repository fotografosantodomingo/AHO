import 'server-only';
import type Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Idempotency dedup against `public.stripe_events_processed`. Returns
 * `true` if this is the first time we're seeing this event ID and we
 * should run the side effects; `false` if the event was already processed.
 *
 * The check is an INSERT — race-safe. A second handler running concurrently
 * for the same event ID will get a unique-violation and return `false`.
 *
 * The row also captures `event_type` and a small payload summary for
 * post-mortem debugging.
 */
export async function markEventProcessed(event: Stripe.Event): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase.from('stripe_events_processed').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    payload_summary: extractPayloadSummary(event),
  });
  if (!error) return true;
  // 23505 = unique_violation = already processed.
  if (error.code === '23505') return false;
  // Anything else is a real failure; let the webhook handler return a 5xx
  // so Stripe retries.
  throw error;
}

function extractPayloadSummary(event: Stripe.Event): Record<string, unknown> {
  const obj = event.data.object as unknown as Record<string, unknown>;
  return {
    object_id: obj.id,
    object_type: obj.object,
    livemode: event.livemode,
    api_version: event.api_version,
  };
}
