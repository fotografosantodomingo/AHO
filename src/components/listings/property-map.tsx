'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

/**
 * Leaflet-backed map view. The parent owns the listings (the map is a
 * pure render) and gets a callback when the user pans/zooms — the
 * parent decides what to fetch and feeds the next frame's listings
 * back in.
 *
 * Critical SSR detail: Leaflet calls `window.HTMLElement` at module
 * load. A bare `import L from 'leaflet'` therefore fails on the
 * Cloudflare Edge runtime. Fix: import Leaflet INSIDE useEffect via
 * dynamic `import()`. The Leaflet CSS is fetched from unpkg as a
 * one-shot `<link>` tag injection so we don't thread CSS-in-JS
 * through the bundler.
 *
 * Tiles: OpenStreetMap (free, attribution rendered automatically).
 */

interface PropertyMapProps {
  listings: SearchListing[];
  locale: Locale;
  /**
   * Called (debounced 400ms after `moveend`) with the new bounds.
   * The parent typically refetches and feeds back via `listings`.
   * Optional — when omitted, the map is read-only (no callback).
   */
  onBoundsChange?: (bounds: {
    swLat: number;
    swLng: number;
    neLat: number;
    neLng: number;
  }) => void;
  /**
   * Render an "Updating" chip in the top-right while the parent's
   * fetch is in-flight. Optional; defaults to off.
   */
  fetching?: boolean;
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

export function PropertyMap({
  listings,
  locale,
  onBoundsChange,
  fetching,
}: PropertyMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [ready, setReady] = useState(false);
  const fetchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest onBoundsChange ref so the moveend handler reads the current
  // function without forcing the effect to re-bind on every parent
  // re-render.
  const onBoundsChangeRef = useRef(onBoundsChange);
  onBoundsChangeRef.current = onBoundsChange;

  const pinned = useMemo(
    () => listings.filter((l) => l.latitude != null && l.longitude != null),
    [listings],
  );

  // Initialize Leaflet on mount.
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

      // Bbox callback on pan/zoom — debounced 400ms.
      const onMoveEnd = () => {
        const m = mapRef.current;
        if (!m) return;
        if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
        fetchTimeout.current = setTimeout(() => {
          const b = m.getBounds();
          const sw = b.getSouthWest();
          const ne = b.getNorthEast();
          onBoundsChangeRef.current?.({
            swLat: sw.lat,
            swLng: sw.lng,
            neLat: ne.lat,
            neLng: ne.lng,
          });
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
  }, []);

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

      if (pinned.length === 0) return;

      const pathSegment = locale === 'es' ? 'propiedades' : 'properties';
      for (const l of pinned) {
        if (l.latitude == null || l.longitude == null) continue;
        const slug = locale === 'es' ? l.slugEs ?? l.slugEn : l.slugEn ?? l.slugEs;
        const href = slug ? `/${locale}/${pathSegment}/${slug}-${l.shortId}` : null;
        const title =
          (locale === 'es' ? l.titleEs : l.titleEn) ?? l.titleEn ?? l.titleEs ?? '—';
        const popupHtml = href
          ? `<a href="${escapeHtml(href)}" style="font-weight:600;text-decoration:underline;color:inherit;">${escapeHtml(title)}</a><br/><span style="color:#656a76;font-size:12px;">${escapeHtml(l.city)}, ${escapeHtml(l.countryCode)}</span>`
          : `<strong>${escapeHtml(title)}</strong>`;
        const marker = L.marker([l.latitude, l.longitude]).bindPopup(popupHtml);
        marker.addTo(map);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, pinned, locale]);

  // Initial fit-to-bounds for the seeded markers — only the first time
  // we have markers + the map is ready. After the user pans, we don't
  // auto-fit (would yank them around mid-browse).
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!ready || fittedRef.current) return;
    const map = mapRef.current;
    if (!map || pinned.length === 0) return;
    let cancelled = false;
    void (async () => {
      const Lmod = await import('leaflet');
      if (cancelled) return;
      const L = Lmod.default;
      if (pinned.length === 1) {
        const only = pinned[0];
        if (only?.latitude != null && only.longitude != null) {
          map.setView([only.latitude, only.longitude], 13);
        }
      } else {
        const bounds = L.latLngBounds(
          pinned.map((m) => [m.latitude as number, m.longitude as number]),
        );
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
      fittedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, pinned]);

  return (
    <div className="relative">
      <div
        ref={mapEl}
        role="application"
        aria-label="Map of property listings"
        className="aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-muted shadow-whisper sm:aspect-[16/9] dark:bg-surface-dark"
      />
      {ready && pinned.length === 0 && listings.length > 0 && !fetching && (
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
