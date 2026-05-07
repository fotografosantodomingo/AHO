'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ListingCard } from './listing-card';
import { MapView } from './map-view';
import type { SearchFilters, SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';
import {
  encodeBbox,
  parseBbox,
  type BboxView,
} from '@/lib/listings/bbox-url';

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
 *
 * URL-state persistence
 *   The bbox view is mirrored to `?bbox=swLat,swLng,neLat,neLng,zoom`
 *   via `history.replaceState` (NOT next/router). Two reasons we go
 *   under the router:
 *     1. The /search page is a Server Component for the LCP win — its
 *        initial paint comes from a server-side searchListings() query.
 *        A router.replace() would re-trigger that Server Component
 *        render on every map pan and tank perceived performance.
 *     2. We don't actually want the *server-rendered* page to vary by
 *        bbox; bbox is layered on top after first paint. The URL is
 *        purely a "share this view" affordance.
 *   On mount, if `?bbox=...` is present in the initial URL, we fire a
 *   bbox fetch immediately (same code path as a user pan) so a copied
 *   link drops the visitor directly into the panned view.
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
  /** Locale-resolved "X listings in this area" template (with `{count}`).
   *  Only swapped in when bbox-driven mode is active; the wider
   *  `resultsCountTemplate` is used otherwise. Falls back silently to
   *  `resultsCountTemplate` if omitted (older callers). */
  resultsCountInAreaTemplate?: string;
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
  resultsCountInAreaTemplate,
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
  // Initial bbox seeded from the URL on mount. The map reads this prop
  // synchronously when it initializes Leaflet so a shared `?bbox=...`
  // link drops you straight into the panned view rather than starting
  // at the world view and animating.
  const [initialBbox, setInitialBbox] = useState<BboxView | null>(null);

  // URL-state mirroring helpers. Both run only on the client (window
  // available); both no-op safely on SSR.

  function syncBboxToUrl(bbox: BboxView | null): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (bbox) {
      const encoded = encodeBbox(bbox);
      if (encoded) {
        url.searchParams.set('bbox', encoded);
      } else {
        url.searchParams.delete('bbox');
      }
    } else {
      url.searchParams.delete('bbox');
    }
    // Use replaceState (not pushState) so map pans don't pollute the
    // back button — one click of Back should leave /search entirely,
    // not unwind 30 micro-pans.
    window.history.replaceState(window.history.state, '', url.toString());
  }

  // Reset to server-side data when user toggles bbox mode off. Also drop
  // the URL bbox param so the canonical filtered URL is shareable again.
  function resetBbox() {
    setBboxActive(false);
    setListings(initialListings);
    syncBboxToUrl(null);
  }

  async function handleBoundsChange(bounds: BboxView) {
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
    // Country-overview mode at low zoom — include listings without
    // precise lat/lng so agents who haven't entered exact coordinates
    // are still represented (plotted via country centroid by the map).
    // Threshold 6 ≈ "country fits in viewport". At zoom 7+ we want
    // city-precise pins only.
    if (bounds.zoom < 6) params.set('include_no_coords', '1');

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
      // Mirror the current view to URL — only after the fetch succeeded
      // so we don't paint a URL pointing at a bbox we couldn't load.
      syncBboxToUrl(bounds);
    } catch {
      // Network error — keep existing pins, drop chip.
    } finally {
      if (seq === requestSeq.current) setFetching(false);
    }
  }

  // On mount, restore bbox view from URL if a `?bbox=...` param is
  // present. Done in useEffect (not during render) so server-render is
  // unaffected — the SSR'd page still uses the full filter result set
  // for LCP. Once we're on the client, kick off the same fetch path the
  // user pan uses.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = new URL(window.location.href).searchParams.get('bbox');
    const restored = parseBbox(raw);
    if (!restored) return;
    setInitialBbox(restored);
    void handleBoundsChange(restored);
    // Empty deps: fire once on mount. Stale-closure note — handleBoundsChange
    // closes over `filters`, but `filters` on /search is itself derived
    // from the URL params at request time, so the closure captures the
    // same filters the server-rendered page used. Future-proofing:
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {/* In map view we ALWAYS keep the map mounted, even with 0 listings.
          Unmounting the map on empty result sets caused the "map appears
          for a fraction of a second and disappears" bug — fitBounds() on
          the initial pin fired a moveend → bbox fetch returned 0 (because
          the listing had no precise lat/lng) → setListings([]) → React
          rendered the empty-state branch → map unmounted. The empty-state
          message is shown over the map in that case. */}
      {view === 'map' ? (
        <>
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {listings.length === 0
              ? noResultsLabel
              : countTemplate(
                  bboxActive,
                  resultsCountTemplate,
                  resultsCountInAreaTemplate,
                ).replace('{count}', String(listings.length)) +
                (!bboxActive && initialHasMore ? '+' : '')}
          </p>
          <MapView
            listings={listings}
            locale={locale}
            onBoundsChange={handleBoundsChange}
            fetching={fetching}
            initialBbox={initialBbox}
          />
        </>
      ) : listings.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          <p>{noResultsLabel}</p>
          <p className="mt-2 text-xs text-helper">{noResultsHintLabel}</p>
        </div>
      ) : (
        <>
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {countTemplate(
              bboxActive,
              resultsCountTemplate,
              resultsCountInAreaTemplate,
            ).replace('{count}', String(listings.length))}
            {!bboxActive && initialHasMore ? '+' : ''}
          </p>
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

/**
 * Pick the right "X listings" / "X listings in this area" copy. Falls
 * back to the wider `resultsCountTemplate` when the in-area variant
 * isn't supplied — keeps older callers working without forcing every
 * caller to pass both strings.
 */
function countTemplate(
  bboxActive: boolean,
  resultsCountTemplate: string,
  resultsCountInAreaTemplate: string | undefined,
): string {
  if (bboxActive && resultsCountInAreaTemplate) {
    return resultsCountInAreaTemplate;
  }
  return resultsCountTemplate;
}
