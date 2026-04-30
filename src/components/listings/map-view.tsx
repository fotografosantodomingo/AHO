'use client';

import { PropertyMap } from './property-map';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

/**
 * Thin re-export that gives the search page a stable import path.
 *
 * We deliberately do NOT wrap PropertyMap in `next/dynamic({ssr:false})`
 * — that pattern has had interop issues with Next.js 15 + next-on-pages
 * (manifest as 500s on the SSR pass even when the inner component isn't
 * supposed to be rendered server-side).
 *
 * Instead, PropertyMap lazy-imports Leaflet INSIDE useEffect — server
 * renders the placeholder div, browser fetches Leaflet on mount. Same
 * net effect as ssr:false, but the bundler treats this Client Component
 * as a normal one and doesn't get confused.
 */
interface MapViewProps {
  listings: SearchListing[];
  locale: Locale;
}

export function MapView({ listings, locale }: MapViewProps) {
  return <PropertyMap listings={listings} locale={locale} />;
}
