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
const MARKERCLUSTER_CSS_URLS = [
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
] as const;

function ensureCss(href: string, integrity?: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  if (integrity) {
    link.integrity = integrity;
    link.crossOrigin = 'anonymous';
  }
  document.head.appendChild(link);
}

function ensureLeafletCss(): void {
  ensureCss(LEAFLET_CSS_URL, LEAFLET_CSS_INTEGRITY);
  for (const href of MARKERCLUSTER_CSS_URLS) ensureCss(href);
  ensureClusterThemeOverride();
}

/**
 * Re-skin the leaflet.markercluster default theme to match AHO's design
 * tokens. The default is a green / yellow / red gradient by count which
 * looks alarming and doesn't match the HashiCorp single-accent palette.
 *
 * Override colors to monochromatic action-blue (`--color-action`,
 * `--color-action-dark`, `--color-action-active` from globals.css) with
 * a subtle outer ring at 0.4 opacity. Same three count thresholds the
 * plugin uses by default (small <10, medium <100, large 100+).
 */
function ensureClusterThemeOverride(): void {
  if (typeof document === 'undefined') return;
  const id = 'aho-cluster-theme';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
.marker-cluster-small { background-color: rgb(34 100 214 / 0.4); }
.marker-cluster-small div { background-color: rgb(34 100 214); color: #efeff1; }
.marker-cluster-medium { background-color: rgb(16 96 255 / 0.4); }
.marker-cluster-medium div { background-color: rgb(16 96 255); color: #efeff1; }
.marker-cluster-large { background-color: rgb(43 137 255 / 0.4); }
.marker-cluster-large div { background-color: rgb(43 137 255); color: #efeff1; }
.marker-cluster div { font-family: var(--font-system, system-ui), sans-serif; font-weight: 600; }
`;
  document.head.appendChild(style);
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
  // Uses leaflet.markercluster: nearby pins group into a circle showing
  // the count, expands when clicked (Zillow / Redfin pattern). Critical
  // for high-density cities — without clustering, 50+ overlapping pins
  // are unreadable.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    void (async () => {
      const Lmod = await import('leaflet');
      if (cancelled) return;
      const L = Lmod.default;
      // The plugin attaches itself to the global L when imported. After
      // the import resolves, L.markerClusterGroup is available.
      await import('leaflet.markercluster');
      if (cancelled) return;

      // Clear existing layers except the TileLayer.
      map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) {
          map.removeLayer(layer);
        }
      });

      if (pinned.length === 0) return;

      // Cast through unknown — the plugin's typings live on the global
      // Leaflet namespace which TS sometimes doesn't pick up cleanly
      // when the import is dynamic.
      const cluster = (
        L as unknown as {
          markerClusterGroup: (opts?: object) => L.LayerGroup & {
            addLayer: (layer: L.Layer) => void;
          };
        }
      ).markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 60,
      });

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
        cluster.addLayer(marker);
      }

      cluster.addTo(map);
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
