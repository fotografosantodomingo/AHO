'use client';

import { useRef, useState, useTransition } from 'react';
import { ListingCard } from './listing-card';
import { MapView } from './map-view';
import type { SearchFilters, SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

/**
 * Client-side shell around the list + map results sections of /search.
 *
 * Lifts the bbox state up so list and map render from the same source
 * of truth: when the user pans the map, both update. (Before this, map
 * pans only changed pins; the list kept showing the original
 * server-side filter results — they diverged.)
 *
 * State machine:
 *   - Initial render: `listings = initialListings` (server-rendered).
 *     Pagination links + result-count strap reflect the server-side
 *     full-paginated result set.
 *   - User pans map: `bboxActive = true`, fetch /api/properties/by-bbox
 *     with current filters + bounds, replace `listings`. Pagination
 *     hidden (bbox-driven results don't paginate the same way).
 *   - User clicks "Reset to all results": clears bbox state, restores
 *     initialListings. Pagination back.
 *
 * The view toggle (list | map) is the same — just decides which child
 * to render. Both children render off the same `listings` state so
 * switching views is instant.
 */

interface SearchResultsViewProps {
  initialListings: SearchListing[];
  initialHasMore: boolean;
  filters: SearchFilters;
  locale: Locale;
  view: 'list' | 'map';
  prevHref: string | null;
  nextHref: string | null;
  resultsCountTemplate: string;
  noResultsLabel: string;
  noResultsHintLabel: string;
  prevPageLabel: string;
  nextPageLabel: string;
  resetBboxLabel: string;
  bboxActiveLabel: string;
  /** Initial approx-converted price labels keyed by listing id, computed
   *  server-side. Bbox-driven updates degrade to source-only — the bbox
   *  endpoint doesn't return approx labels (deferred to v1.1). */
  initialApproxLabels?: Record<string, string>;
  /** Server-resolved set of listing IDs the buyer has favorited. Bbox-
   *  driven results inherit `false` for newly-visible listings until the
   *  user clicks the heart (which optimistically flips locally + persists
   *  via the toggle API). */
  initialFavoriteIds?: string[];
  /** Whether there's a signed-in user (so the heart bounces to /signin
   *  instead of POSTing on click). */
  isAuthed?: boolean;
}

export function SearchResultsView({
  initialListings,
  initialHasMore,
  filters,
  locale,
  view,
  prevHref,
  nextHref,
  resultsCountTemplate,
  noResultsLabel,
  noResultsHintLabel,
  prevPageLabel,
  nextPageLabel,
  resetBboxLabel,
  bboxActiveLabel,
  initialApproxLabels,
  initialFavoriteIds,
  isAuthed = false,
}: SearchResultsViewProps) {
  const favoriteSet = new Set(initialFavoriteIds ?? []);
  // Track whether bbox-driven mode is active. While inactive, listings =
  // initialListings (server-rendered for SSR + SEO). While active, listings
  // come from the latest /api/properties/by-bbox response.
  const [bboxActive, setBboxActive] = useState(false);
  const [listings, setListings] = useState<SearchListing[]>(initialListings);
  const [, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const requestSeq = useRef(0);

  // Reset to server-side data when user toggles bbox mode off.
  function resetBbox() {
    setBboxActive(false);
    setListings(initialListings);
  }

  async function handleBoundsChange(bounds: {
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
  }) {
    const params = new URLSearchParams({
      sw_lat: String(bounds.swLat),
      sw_lng: String(bounds.swLng),
      ne_lat: String(bounds.neLat),
      ne_lng: String(bounds.neLng),
    });
    if (filters.q) params.set('q', filters.q);
    if (filters.city) params.set('city', filters.city);
    if (filters.country) params.set('country', filters.country);
    if (filters.transaction) params.set('transaction', filters.transaction);
    if (filters.minPrice != null) params.set('min_price', String(filters.minPrice));
    if (filters.maxPrice != null) params.set('max_price', String(filters.maxPrice));
    if (filters.bedsMin != null) params.set('beds_min', String(filters.bedsMin));

    const seq = ++requestSeq.current;
    setFetching(true);
    try {
      const res = await fetch(`/api/properties/by-bbox?${params}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return;
      const json: { listings?: SearchListing[] } = await res.json();
      // Drop response if a newer fetch has been issued.
      if (seq !== requestSeq.current) return;
      startTransition(() => {
        setListings(json.listings ?? []);
        setBboxActive(true);
      });
    } catch {
      // Network error — keep existing pins, drop chip.
    } finally {
      if (seq === requestSeq.current) setFetching(false);
    }
  }

  return (
    <>
      {bboxActive && (
        <div className="flex items-center justify-between rounded-lg border border-border-strong/60 bg-surface px-3 py-2 text-xs shadow-whisper dark:bg-surface-deep">
          <p className="text-helper">{bboxActiveLabel}</p>
          <button
            type="button"
            onClick={resetBbox}
            className="rounded-lg border border-border-strong px-2 py-0.5 text-xs transition hover:bg-surface dark:hover:bg-surface-deep"
          >
            {resetBboxLabel}
          </button>
        </div>
      )}

      {listings.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          <p>{noResultsLabel}</p>
          <p className="mt-2 text-xs text-helper">{noResultsHintLabel}</p>
        </div>
      ) : (
        <>
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {resultsCountTemplate.replace('{count}', String(listings.length))}
            {!bboxActive && initialHasMore ? '+' : ''}
          </p>

          {view === 'map' ? (
            <MapView
              listings={listings}
              locale={locale}
              onBoundsChange={handleBoundsChange}
              fetching={fetching}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((l) => (
                <li key={l.id}>
                  <ListingCard
                    listing={l}
                    locale={locale}
                    approxPriceLabel={
                      bboxActive ? null : initialApproxLabels?.[l.id] ?? null
                    }
                    favorited={favoriteSet.has(l.id)}
                    isAuthed={isAuthed}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Pagination — only render when bbox-driven mode is OFF and the
          server-side result set has more pages. Bbox results don't
          paginate (capped at 200; the interaction model is "pan to see
          more"). */}
      {!bboxActive && (prevHref || nextHref) && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between border-t border-border pt-4"
        >
          {prevHref ? (
            <a
              href={prevHref}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {prevPageLabel}
            </a>
          ) : (
            <span />
          )}
          {nextHref && (
            <a
              href={nextHref}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {nextPageLabel}
            </a>
          )}
        </nav>
      )}
    </>
  );
}
