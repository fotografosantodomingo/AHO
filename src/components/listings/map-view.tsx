'use client';

import { PropertyMap } from './property-map';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';
import type { BboxView } from '@/lib/listings/bbox-url';

/**
 * Thin re-export that forwards props to PropertyMap. Stable import path
 * for the search page; lets PropertyMap evolve without churning page-level
 * imports.
 *
 * Why no next/dynamic({ssr:false}) wrapper: PropertyMap already lazy-
 * imports Leaflet inside useEffect so SSR never touches the Leaflet
 * module. The dynamic-import-with-ssr-false pattern has had Edge-runtime
 * interop issues with Next.js 15 + next-on-pages (caused 500s during
 * SSR even when the inner component shouldn't render server-side).
 */
interface MapViewProps {
  listings: SearchListing[];
  locale: Locale;
  onBoundsChange?: (bounds: BboxView) => void;
  fetching?: boolean;
  /** When provided, fit the map to this bbox on initial render instead
   *  of starting at the world view. Used to restore a `?bbox=...`
   *  shared-link view without an animation jitter through the world
   *  view first. Null/undefined → world view as before. */
  initialBbox?: BboxView | null;
}

export function MapView({
  listings,
  locale,
  onBoundsChange,
  fetching,
  initialBbox,
}: MapViewProps) {
  return (
    <PropertyMap
      listings={listings}
      locale={locale}
      onBoundsChange={onBoundsChange}
      fetching={fetching}
      initialBbox={initialBbox}
    />
  );
}
