import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PropertyEventType } from '@/db/schema';

/**
 * Server-side helper for the property-engagement analytics layer
 * (feat/property-analytics, migration 0027).
 *
 * Append-only inserts into `property_events`. Best-effort: errors are
 * logged, never thrown — analytics tracking failures must never break
 * the user-facing flow.
 *
 * Identity: at least one of (userId, anonymousId) is normally set.
 * Allowed to be both-null in edge cases (e.g. lead_form_submit from
 * an anon visitor whose cookie hasn't been issued yet).
 *
 * org_id is denormalized onto the event row so dashboard aggregations
 * don't need to join through `properties`. Caller must pass it
 * pre-resolved (lookup from `properties.org_id` once when building
 * the request context).
 */

interface RecordEventArgs {
  /** Service-role admin client. Required because RLS has no INSERT
   *  policy on property_events. */
  supabase: SupabaseClient;
  propertyId: string;
  /** Pre-resolved from `properties.org_id`. */
  orgId: string;
  eventType: PropertyEventType;
  userId?: string | null;
  anonymousId?: string | null;
  /** Short tag — where the visitor came from (e.g. 'search', 'home',
   *  'similar'). Optional. */
  source?: string | null;
  /** Free-form metadata — e.g. { contact_method: 'whatsapp' } on a
   *  lead_form_submit; { referrer_listing_id: '...' } on view from
   *  similar-homes. */
  metadata?: Record<string, unknown>;
}

export async function recordPropertyEvent({
  supabase,
  propertyId,
  orgId,
  eventType,
  userId = null,
  anonymousId = null,
  source = null,
  metadata = {},
}: RecordEventArgs): Promise<void> {
  const { error } = await supabase.from('property_events').insert({
    property_id: propertyId,
    org_id: orgId,
    user_id: userId,
    anonymous_id: anonymousId,
    event_type: eventType,
    source,
    metadata,
  });
  if (error) {
    console.warn('[events] insert failed', {
      eventType,
      propertyId,
      error: error.message,
    });
  }
}
