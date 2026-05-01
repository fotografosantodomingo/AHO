'use client';

import type { PropertyEventType } from '@/db/schema';
import { trackPropertyEvent } from '@/lib/analytics/client';

interface Props extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'onClick'> {
  propertyId: string;
  eventType: PropertyEventType;
  source?: string;
  metadata?: Record<string, unknown>;
}

/**
 * `<a>` wrapper that fires an analytics event before the navigation
 * happens. Uses `keepalive` on the fetch so the request survives the
 * page unload — important for outbound links (whatsapp, tel:, mailto:)
 * where the browser would otherwise abort the in-flight request as it
 * leaves the page.
 *
 * Visual / a11y / behavior identical to a plain `<a>`. The wrapper
 * exists to add the click tracker without making the entire property
 * detail page a Client Component.
 */
export function TrackedLink({
  propertyId,
  eventType,
  source,
  metadata,
  children,
  ...rest
}: Props & { onClick?: never }) {
  return (
    <a
      {...rest}
      onClick={() => {
        // Don't await — analytics is fire-and-forget. trackPropertyEvent
        // uses fetch's keepalive flag, so the POST survives navigation.
        void trackPropertyEvent(propertyId, eventType, { source, metadata });
      }}
    >
      {children}
    </a>
  );
}
