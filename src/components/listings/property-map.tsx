'use client';

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';

/**
 * Leaflet-backed map view of search results.
 *
 * Why a vanilla-Leaflet wrapper instead of `react-leaflet`:
 *   react-leaflet doesn't ship a fully-typed React 19 / Next.js 15
 *   compatible release as of v5; the JSX child contracts had peer-dep
 *   warnings + runtime errors in early testing on Cloudflare Pages.
 *   Vanilla Leaflet via a `useEffect` + ref is ~80 lines and avoids
 *   the wrapper layer entirely.
 *
 * Tiles: OpenStreetMap (free for low-medium traffic, attribution
 * required and rendered automatically by Leaflet's TileLayer).
 *
 * SSR concern: Leaflet touches `window` at module-load time. The
 * parent `<MapView>` wraps THIS component in a `next/dynamic` import
 * with `ssr: false`, so Leaflet's import here only runs in the browser.
 */

interface PropertyMapProps {
  listings: SearchListing[];
  locale: Locale;
}

const DEFAULT_CENTER: [number, number] = [18.4861, -69.9312]; // Santo Domingo
const DEFAULT_ZOOM = 5;

export function PropertyMap({ listings, locale }: PropertyMapProps) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Listings with valid coords. Listings without lat/lng (legacy or
  // not-yet-trigger-populated rows) are silently filtered — they're
  // still in the side list, just not pinned on the map.
  const pinned = useMemo(
    () => listings.filter((l) => l.latitude != null && l.longitude != null),
    [listings],
  );

  useEffect(() => {
    if (!mapEl.current) return;
    if (mapRef.current) return; // already initialized

    // Patch Leaflet's default icon URLs — the bundler-resolved paths
    // don't match Leaflet's expectations. Use a plain colored marker.
    const map = L.map(mapEl.current, { zoomControl: true }).setView(
      DEFAULT_CENTER,
      DEFAULT_ZOOM,
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers whenever the listings change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing markers (Leaflet doesn't have a clean "replace all"
    // primitive; we walk all layers and remove ones that aren't tile layers).
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
  }, [pinned, locale]);

  return (
    <div className="relative">
      <div
        ref={mapEl}
        role="application"
        aria-label="Map of property listings"
        className="aspect-[4/3] w-full overflow-hidden rounded-card border border-border shadow-whisper sm:aspect-[16/9]"
      />
      {pinned.length === 0 && listings.length > 0 && (
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
