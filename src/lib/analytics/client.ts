/**
 * Tiny client-side analytics fire-and-forget helper. POSTs to
 * `/api/properties/[id]/event`. Failures are silently dropped —
 * tracking must never block UX.
 *
 * Usage from a Client Component:
 *
 *   import { trackPropertyEvent } from '@/lib/analytics/client';
 *   <a
 *     href="https://wa.me/..."
 *     onClick={() => trackPropertyEvent(propertyId, 'whatsapp_click')}
 *   >…</a>
 *
 * The endpoint validates the event_type against the allowed-from-client
 * set; calling with a server-side-only type (property_view,
 * lead_form_submit, favorite_add) returns 400 — caught at code review,
 * not at runtime.
 */

import type { PropertyEventType } from '@/db/schema';

export async function trackPropertyEvent(
  propertyId: string,
  eventType: PropertyEventType,
  options: {
    source?: string;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await fetch(`/api/properties/${propertyId}/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventType,
        source: options.source,
        metadata: options.metadata,
      }),
      // keepalive lets the request survive page navigation — important
      // for click events on outbound links (whatsapp_click etc.) where
      // the page is unloading milliseconds after the click.
      keepalive: true,
    });
  } catch {
    /* silent */
  }
}
