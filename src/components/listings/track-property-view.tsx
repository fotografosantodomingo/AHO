'use client';

import { useEffect } from 'react';
import { useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';

interface Props {
  propertyId: string;
}

/**
 * Fire-and-forget tracker for the "Recently viewed" feature
 * (feat/recently-viewed). Mounted on /properties/[slug]; on first
 * paint it POSTs to /api/properties/:id/view to record the view.
 *
 * Why a client tracker (instead of recording on the Server Component
 * render): Server Components can READ cookies but can't SET them. The
 * route handler sets the `aho_anon_id` cookie on first visit, returns
 * Set-Cookie headers, and writes the row server-side. The page render
 * stays clean and synchronous; tracking is an asynchronous side effect.
 *
 * Failure modes handled silently: network blip, JS disabled, ad blocker
 * — all degrade to "view not tracked, but page still works." The
 * recently-viewed rail just won't show this listing later.
 */
export function TrackPropertyView({ propertyId }: Props) {
  const locale = useLocale();
  const pathname = usePathname();

  useEffect(() => {
    fetch(`/api/properties/${propertyId}/view`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, sourcePath: pathname }),
    }).catch(() => {
      /* silent — view tracking is best-effort */
    });
  }, [propertyId, locale, pathname]);

  return null;
}
