'use client';

import dynamic from 'next/dynamic';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

/**
 * Browser-only wrapper around <PropertyMap>. Leaflet touches `window`
 * at module-load time, so it can't be imported into a Server Component
 * tree. `next/dynamic` with `ssr: false` defers the import to the
 * browser entirely; the server emits a placeholder div.
 */
const PropertyMap = dynamic(
  () => import('./property-map').then((m) => m.PropertyMap),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden="true"
        className="aspect-[4/3] w-full animate-pulse rounded-card border border-border bg-surface-muted shadow-whisper sm:aspect-[16/9] dark:bg-surface-dark"
      />
    ),
  },
);

interface MapViewProps {
  listings: SearchListing[];
  locale: Locale;
}

export function MapView({ listings, locale }: MapViewProps) {
  return <PropertyMap listings={listings} locale={locale} />;
}
