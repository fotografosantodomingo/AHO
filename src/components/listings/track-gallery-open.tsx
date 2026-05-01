'use client';

import { useRef } from 'react';
import { trackPropertyEvent } from '@/lib/analytics/client';

interface Props {
  propertyId: string;
  children: React.ReactNode;
}

/**
 * Client wrapper around `<PropertyGallery>` (Server Component) that
 * fires `image_gallery_open` once on the first click anywhere within
 * the gallery. Subsequent clicks are no-ops (de-dup at the
 * page-render-lifetime level — refreshing the page resets the firing).
 *
 * Why a wrapper instead of converting PropertyGallery to a Client
 * Component: the gallery itself benefits from server-rendering for
 * SEO image alt text + LCP. This wrapper is a thin click capture only.
 */
export function TrackGalleryOpen({ propertyId, children }: Props) {
  const fired = useRef(false);

  function onClick() {
    if (fired.current) return;
    fired.current = true;
    void trackPropertyEvent(propertyId, 'image_gallery_open');
  }

  return (
    <div onClick={onClick} onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      {children}
    </div>
  );
}
