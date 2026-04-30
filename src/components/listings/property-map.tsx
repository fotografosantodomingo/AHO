'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

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

export function PropertyMap({ listings, locale }: PropertyMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [ready, setReady] = useState(false);

  // Listings with valid coords. Listings without lat/lng are silently
  // filtered from the map but still appear in the side list.
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
    })();

    return () => {
      cancelled = true;
      if (map) {
        map.remove();
      }
      mapRef.current = null;
    };
  }, []);

  // Update markers whenever the listings change (and the map is ready).
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;

    void (async () => {
      const Lmod = await import('leaflet');
      const L = Lmod.default;

      // Clear existing markers (preserve TileLayer).
      map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) {
          map.removeLayer(layer);
        }
      });

      if (pinned.length === 0) return;

      const bounds = L.latLngBounds([]);
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
        bounds.extend([l.latitude, l.longitude]);
      }

      if (pinned.length === 1) {
        const only = pinned[0];
        if (only?.latitude != null && only.longitude != null) {
          map.setView([only.latitude, only.longitude], 13);
        }
      } else {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    })();
  }, [ready, pinned, locale]);

  return (
    <div className="relative">
      <div
        ref={mapEl}
        role="application"
        aria-label="Map of property listings"
        className="aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface-muted shadow-whisper sm:aspect-[16/9] dark:bg-surface-dark"
      />
      {ready && pinned.length === 0 && listings.length > 0 && (
        <p className="absolute left-3 top-3 rounded-lg bg-surface/90 px-3 py-1.5 text-xs text-helper backdrop-blur-sm dark:bg-surface-deep/90">
          No listings on this page have a saved location yet.
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
