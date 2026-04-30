'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

/** Tighter shape returned by /api/properties/by-bbox. The map only
 *  needs a subset of SearchListing's fields. */
interface MapMarker {
  id: string;
  shortId: string;
  slugEn: string | null;
  slugEs: string | null;
  titleEn: string | null;
  titleEs: string | null;
  city: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

/**
 * Leaflet-backed map view of search results.
 *
 * Critical SSR detail: Leaflet calls `window.HTMLElement` at module-load
 * time. A bare `import L from 'leaflet'` therefore fails on the Cloudflare
 * Edge runtime even when this Client Component is wrapped in a
 * `next/dynamic({ssr:false})` boundary — the imported module still gets
 * evaluated during the server-side bundle's chain.
 *
 * Fix: import Leaflet INSIDE useEffect via dynamic `import()`. That
 * defers the entire module load to the browser, post-mount, where
 * `window` exists. The Leaflet CSS is fetched from the unpkg CDN as a
 * one-shot `<link>` tag injection so we don't need to thread CSS-in-JS
 * through the bundler either.
 *
 * Tiles: OpenStreetMap (free, attribution rendered automatically).
 */

interface PropertyMapProps {
  listings: SearchListing[];
  locale: Locale;
}

const DEFAULT_CENTER: [number, number] = [18.4861, -69.9312]; // Santo Domingo
const DEFAULT_ZOOM = 5;
const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_CSS_INTEGRITY =
  'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H';

function ensureLeafletCss(): void {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_URL;
  link.integrity = LEAFLET_CSS_INTEGRITY;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}

/** Convert a SearchListing into the tighter MapMarker shape, dropping
 *  rows with missing coords. Used for the initial server-rendered set. */
function listingsToMarkers(listings: SearchListing[]): MapMarker[] {
  return listings.flatMap((l) =>
    l.latitude != null && l.longitude != null
      ? [
          {
            id: l.id,
            shortId: l.shortId,
            slugEn: l.slugEn,
            slugEs: l.slugEs,
            titleEn: l.titleEn,
            titleEs: l.titleEs,
            city: l.city,
            countryCode: l.countryCode,
            latitude: l.latitude,
            longitude: l.longitude,
          },
        ]
      : [],
  );
}

export function PropertyMap({ listings, locale }: PropertyMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [ready, setReady] = useState(false);
  const [markers, setMarkers] = useState<MapMarker[]>(() =>
    listingsToMarkers(listings),
  );
  const [fetching, setFetching] = useState(false);
  // Track the latest in-flight request so out-of-order responses don't
  // overwrite fresher state. Each fetch increments this counter and only
  // the highest counter at resolution time is allowed to setMarkers.
  const requestSeq = useRef(0);
  const fetchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset markers if the parent's `listings` prop changes (e.g., user
  // changed filters and the search page re-renders with new server-side
  // results). Once the user pans the map, bbox-fetched markers take over.
  useEffect(() => {
    setMarkers(listingsToMarkers(listings));
  }, [listings]);

  // Initialize Leaflet on mount + wire moveend → debounced bbox fetch.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    void (async () => {
      ensureLeafletCss();
      const Lmod = await import('leaflet');
      const L = Lmod.default;
      if (cancelled || !mapEl.current) return;

      map = L.map(mapEl.current, { zoomControl: true }).setView(
        DEFAULT_CENTER,
        DEFAULT_ZOOM,
      );
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      mapRef.current = map;
      setReady(true);

      // Bbox fetch on pan/zoom — debounced 400ms after the user stops moving.
      const onMoveEnd = () => {
        if (!mapRef.current) return;
        if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
        fetchTimeout.current = setTimeout(() => {
          void fetchBbox();
        }, 400);
      };
      map.on('moveend', onMoveEnd);
    })();

    return () => {
      cancelled = true;
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
      if (map) map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Read the map's current bounds and fetch listings within. */
  async function fetchBbox(): Promise<void> {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const params = new URLSearchParams({
      sw_lat: String(sw.lat),
      sw_lng: String(sw.lng),
      ne_lat: String(ne.lat),
      ne_lng: String(ne.lng),
    });
    const seq = ++requestSeq.current;
    setFetching(true);
    try {
      const res = await fetch(`/api/properties/by-bbox?${params}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        // Keep existing pins on error; just clear the loading chip.
        return;
      }
      const json: { listings?: MapMarker[] } = await res.json();
      // Drop response if a newer fetch has been issued.
      if (seq !== requestSeq.current) return;
      setMarkers(json.listings ?? []);
    } catch {
      // Network error — keep existing pins, drop chip.
    } finally {
      if (seq === requestSeq.current) setFetching(false);
    }
  }

  // Render markers whenever they change AND the map is ready.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    void (async () => {
      const Lmod = await import('leaflet');
      if (cancelled) return;
      const L = Lmod.default;

      // Clear existing markers (preserve TileLayer).
      map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) {
          map.removeLayer(layer);
        }
      });

      if (markers.length === 0) return;

      const pathSegment = locale === 'es' ? 'propiedades' : 'properties';
      for (const m of markers) {
        const slug = locale === 'es' ? m.slugEs ?? m.slugEn : m.slugEn ?? m.slugEs;
        const href = slug ? `/${locale}/${pathSegment}/${slug}-${m.shortId}` : null;
        const title =
          (locale === 'es' ? m.titleEs : m.titleEn) ?? m.titleEn ?? m.titleEs ?? '—';
        const popupHtml = href
          ? `<a href="${escapeHtml(href)}" style="font-weight:600;text-decoration:underline;color:inherit;">${escapeHtml(title)}</a><br/><span style="color:#656a76;font-size:12px;">${escapeHtml(m.city)}, ${escapeHtml(m.countryCode)}</span>`
          : `<strong>${escapeHtml(title)}</strong>`;
        const marker = L.marker([m.latitude, m.longitude]).bindPopup(popupHtml);
        marker.addTo(map);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, markers, locale]);

  // Initial fit-to-bounds for the server-rendered markers — only the
  // first time we have markers + the map is ready. After the user pans,
  // we don't auto-fit anymore (would yank them around mid-browse).
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!ready || fittedRef.current) return;
    const map = mapRef.current;
    if (!map || markers.length === 0) return;
    let cancelled = false;
    void (async () => {
      const Lmod = await import('leaflet');
      if (cancelled) return;
      const L = Lmod.default;
      if (markers.length === 1) {
        const only = markers[0];
        if (only) map.setView([only.latitude, only.longitude], 13);
      } else {
        const bounds = L.latLngBounds(markers.map((m) => [m.latitude, m.longitude]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
      fittedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, markers]);

  return (
    <div className="relative">
      <div
        ref={mapEl}
        role="application"
        aria-label="Map of property listings"
        className="aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-muted shadow-whisper sm:aspect-[16/9] dark:bg-surface-dark"
      />
      {ready && markers.length === 0 && listings.length > 0 && !fetching && (
        <p className="absolute left-3 top-3 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-helper backdrop-blur-sm dark:bg-surface-deep/90">
          No listings on this page have a saved location yet.
        </p>
      )}
      {fetching && (
        <p className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-helper shadow-whisper backdrop-blur-sm dark:bg-surface-deep/90">
          <span className="h-2 w-2 animate-pulse rounded-full bg-action" />
          Updating
        </p>
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
