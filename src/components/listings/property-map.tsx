'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import type { SearchListing } from '@/lib/listings/search';
import type { Locale } from '@/i18n/config';
import { countryCentroid } from '@/lib/listings/country-centroids';
import type { BboxView } from '@/lib/listings/bbox-url';

/**
 * Leaflet-backed map view. The parent owns the listings (the map is a
 * pure render) and gets a callback when the user pans/zooms — the
 * parent decides what to fetch and feeds the next frame's listings
 * back in.
 *
 * Critical SSR detail: Leaflet calls `window.HTMLElement` at module
 * load. A bare `import L from 'leaflet'` therefore fails on the
 * Cloudflare Edge runtime. Fix: import Leaflet INSIDE useEffect via
 * dynamic `import()`. The Leaflet CSS is injected as a one-shot
 * `<link>` tag so we don't thread CSS-in-JS through the bundler.
 *
 * Stylesheets are vendored under /public/leaflet/ and served from the
 * same origin — saves a CORS preflight + extra TLS hop on the search
 * page critical path that the previous unpkg.com link cost. The
 * relative `url(images/...)` references in leaflet.css resolve
 * naturally to /leaflet/images/...
 *
 * Tiles: OpenStreetMap (free, attribution rendered automatically).
 */

interface PropertyMapProps {
  listings: SearchListing[];
  locale: Locale;
  /**
   * Called (debounced 400ms after `moveend`) with the new bounds. The
   * `zoom` field on the BboxView lets the parent pick the country-
   * overview endpoint variant (low zoom: include listings without
   * precise lat/lng, plotted via centroid) vs. the precise-only variant
   * (high zoom: real coordinates only). The parent typically refetches
   * and feeds back via `listings`. Optional — when omitted, the map is
   * read-only (no callback).
   */
  onBoundsChange?: (bounds: BboxView) => void;
  /**
   * Render an "Updating" chip in the top-right while the parent's
   * fetch is in-flight. Optional; defaults to off.
   */
  fetching?: boolean;
  /**
   * When provided on first render, fit the map to this bbox instead of
   * starting at the world view. Used to restore a shared `?bbox=...`
   * link without animating through the world view. Read once on mount
   * (subsequent changes are ignored — the map is now driven by the
   * user). Null / undefined → standard world-view start.
   */
  initialBbox?: BboxView | null;
}

// Default world-ish view. Was previously Santo Domingo at zoom 5 — fine
// for the DR launch but jarring for visitors browsing other countries
// (you'd see the Caribbean and wonder where your search results went).
// fitBounds() takes over the moment we have any pins.
const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 2;
// Self-hosted under /public/leaflet/ — vendored from leaflet@1.9.4 +
// leaflet.markercluster@1.5.3. Same-origin = no CORS preflight, no
// extra TLS handshake, and Cloudflare's CDN caches them alongside our
// own static assets. Subresource integrity is unnecessary because the
// browser already trusts our origin under the page's CSP.
const LEAFLET_CSS_URL = '/leaflet/leaflet.css';
const MARKERCLUSTER_CSS_URLS = [
  '/leaflet/markercluster.css',
  '/leaflet/markercluster-default.css',
] as const;

function ensureCss(href: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function ensureLeafletCss(): void {
  ensureCss(LEAFLET_CSS_URL);
  for (const href of MARKERCLUSTER_CSS_URLS) ensureCss(href);
  ensureClusterThemeOverride();
}

/**
 * Re-skin the leaflet.markercluster default theme to match the green pin
 * palette. The default is a green / yellow / red gradient by count which
 * looks alarming and clashes with our pins. Use Tailwind emerald shades
 * (500/600/700) so cluster bubbles stay visually coherent with the
 * surveyed-pin fill (#059669). Same three count thresholds the plugin
 * uses by default (small <10, medium <100, large 100+).
 */
function ensureClusterThemeOverride(): void {
  if (typeof document === 'undefined') return;
  const id = 'aho-cluster-theme';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
.marker-cluster-small { background-color: rgb(16 185 129 / 0.4); }
.marker-cluster-small div { background-color: rgb(16 185 129); color: #ffffff; }
.marker-cluster-medium { background-color: rgb(5 150 105 / 0.4); }
.marker-cluster-medium div { background-color: rgb(5 150 105); color: #ffffff; }
.marker-cluster-large { background-color: rgb(4 120 87 / 0.4); }
.marker-cluster-large div { background-color: rgb(4 120 87); color: #ffffff; }
.marker-cluster div { font-family: var(--font-system, system-ui), sans-serif; font-weight: 600; }
.aho-pin { background: transparent; border: 0; }
`;
  document.head.appendChild(style);
}

export function PropertyMap({
  listings,
  locale,
  onBoundsChange,
  fetching,
  initialBbox,
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
  // Snapshot the initial bbox on mount. The init effect runs once (deps
  // [] below) so it'd capture the prop anyway, but a ref keeps that
  // intent obvious — this is "first paint only," not a tracked input.
  const initialBboxRef = useRef<BboxView | null>(initialBbox ?? null);
  // Tracks whether the post-mount fit-to-pins has run. Declared up here
  // (rather than next to its useEffect below) because the init effect
  // also writes it — when the parent supplied an initialBbox, the user's
  // shared view wins over the auto-fit-to-pins.
  const fittedRef = useRef(false);
  /**
   * Tracks whether the user has actually interacted with the map
   * (dragged or zoomed), as opposed to programmatic camera moves like
   * the initial setView() and the auto-fitBounds() over the seeded
   * pins. Without this gate, every map mount would dispatch a bbox
   * fetch using the default world view, which then re-renders the
   * pins, which fires another moveend, and the page flickers as the
   * map "disappears and reappears" while the feedback loop settles.
   */
  const userInteractedRef = useRef(false);

  /**
   * Pinned listings — pair (listing, [lat, lng], precise?). Listings with
   * a real lat/lng win; ones without fall back to the country centroid so
   * the map isn't empty when agents haven't entered exact coordinates
   * yet. Precise pins use a darker shade so the user can tell at a glance
   * which markers are surveyed vs. approximated.
   *
   * Coordinates are validated here, not at fetch time, because PostgREST
   * returns `numeric` columns as strings and a sloppy form input could
   * produce technically-valid-but-meaningless values like (0, 0). We
   * reject:
   *   - non-finite numbers (NaN from "abc", Infinity)
   *   - out-of-range latitudes (|lat| > 90) and longitudes (|lng| > 180)
   *   - the literal (0, 0) — Null Island, gulf of Guinea — which appears
   *     as a default for forms that submitted lat/lng "0" instead of NULL
   * Any rejected listing falls through to the country-centroid path; if
   * that also fails (unknown country code), the listing is dropped from
   * the map entirely (still appears in the list view).
   */
  const pinned = useMemo<
    Array<{ listing: SearchListing; lat: number; lng: number; precise: boolean }>
  >(() => {
    const out: Array<{
      listing: SearchListing;
      lat: number;
      lng: number;
      precise: boolean;
    }> = [];
    for (const l of listings) {
      if (isValidCoordinate(l.latitude, l.longitude)) {
        out.push({
          listing: l,
          lat: l.latitude as number,
          lng: l.longitude as number,
          precise: true,
        });
        continue;
      }
      const centroid = countryCentroid(l.countryCode);
      if (centroid) {
        // Tiny deterministic jitter so listings sharing a country don't
        // stack into a single un-clickable marker. ~0.05deg ≈ 5km — enough
        // to fan out, small enough that they stay over the country.
        const jitter = (seed: string) => {
          let h = 0;
          for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
          return ((h % 1000) / 1000 - 0.5) * 0.1;
        };
        out.push({
          listing: l,
          lat: centroid[0] + jitter(l.id),
          lng: centroid[1] + jitter(l.id + 'lng'),
          precise: false,
        });
      }
    }
    return out;
  }, [listings]);

  // Initialize Leaflet on mount.
  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;
    const containerEl = mapEl.current;
    // Native event listeners gate "real user interaction". Leaflet's
    // own `dragstart` / `zoomstart` events fire on PROGRAMMATIC camera
    // moves too (notably the auto-fitBounds() after seeded pins arrive)
    // — using them as the gate caused the "map disappears immediately
    // after mount" bug. Native pointerdown / wheel / keydown only fire
    // when the user actually touches the map.
    const markInteracted = () => {
      userInteractedRef.current = true;
    };

    void (async () => {
      ensureLeafletCss();
      const Lmod = await import('leaflet');
      const L = Lmod.default;
      if (cancelled || !mapEl.current) return;

      map = L.map(mapEl.current, { zoomControl: true });
      // If the parent passed an initial bbox (URL-restored shared
      // view), fit to it BEFORE attaching the tileLayer. This avoids
      // the brief world-view paint that fitBounds would otherwise
      // overwrite — visible to the user as a flash of the world map
      // before snapping into the shared view.
      const seedBbox = initialBboxRef.current;
      if (seedBbox) {
        map.fitBounds(
          L.latLngBounds(
            [seedBbox.swLat, seedBbox.swLng],
            [seedBbox.neLat, seedBbox.neLng],
          ),
          { animate: false, padding: [0, 0] },
        );
        // Mark the auto-fit-to-pins as already done so we don't yank
        // the user away from their shared view when pins arrive.
        fittedRef.current = true;
      } else {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      }
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      mapRef.current = map;
      setReady(true);

      // Bbox callback on pan/zoom — debounced 400ms. Gated on actual
      // user interaction via NATIVE input events on the container so
      // programmatic camera moves (initial setView, auto-fitBounds over
      // seeded pins, "Reset to all results") don't trigger a fetch and
      // re-render the parent into an empty state.
      if (containerEl) {
        containerEl.addEventListener('pointerdown', markInteracted, {
          passive: true,
        });
        containerEl.addEventListener('wheel', markInteracted, { passive: true });
        containerEl.addEventListener('keydown', markInteracted);
      }
      const onMoveEnd = () => {
        if (!userInteractedRef.current) return;
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
            zoom: m.getZoom(),
          });
        }, 400);
      };
      map.on('moveend', onMoveEnd);
    })();

    return () => {
      cancelled = true;
      if (fetchTimeout.current) clearTimeout(fetchTimeout.current);
      if (containerEl) {
        containerEl.removeEventListener('pointerdown', markInteracted);
        containerEl.removeEventListener('wheel', markInteracted);
        containerEl.removeEventListener('keydown', markInteracted);
      }
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
      // Pass the whole leaflet module — `divIcon` is on the namespace
      // export. The runtime L (from `Lmod.default`) is the same object,
      // but the type lookup goes via the module not the default.
      const greenIconPrecise = makeGreenIcon(Lmod, true);
      const greenIconApprox = makeGreenIcon(Lmod, false);
      for (const p of pinned) {
        const l = p.listing;
        const slug = locale === 'es' ? l.slugEs ?? l.slugEn : l.slugEn ?? l.slugEs;
        const href = slug ? `/${locale}/${pathSegment}/${slug}-${l.shortId}` : null;
        const title =
          (locale === 'es' ? l.titleEs : l.titleEn) ?? l.titleEn ?? l.titleEs ?? '—';
        const popupHtml = href
          ? `<a href="${escapeHtml(href)}" style="font-weight:600;text-decoration:underline;color:inherit;">${escapeHtml(title)}</a><br/><span style="color:#656a76;font-size:12px;">${escapeHtml(l.city)}, ${escapeHtml(l.countryCode)}${p.precise ? '' : ' · approx'}</span>`
          : `<strong>${escapeHtml(title)}</strong>`;
        const marker = L.marker([p.lat, p.lng], {
          icon: p.precise ? greenIconPrecise : greenIconApprox,
        }).bindPopup(popupHtml);
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
  // auto-fit (would yank them around mid-browse). The `fittedRef` is
  // declared at the top of the component so the init effect can pre-set
  // it when an initialBbox is supplied (URL-restored shared view).
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
        if (only) {
          map.setView([only.lat, only.lng], only.precise ? 13 : 6);
        }
      } else {
        const bounds = L.latLngBounds(pinned.map((m) => [m.lat, m.lng]));
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
        className="aspect-[4/3] w-full overflow-hidden rounded-card border border-border bg-surface shadow-whisper sm:aspect-[16/9] dark:bg-surface-deep"
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

function isValidCoordinate(lat: number | null, lng: number | null): boolean {
  if (lat == null || lng == null) return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  // (0, 0) is "Null Island" off the West African coast — almost certainly
  // a placeholder/default, not a real real-estate listing. Reject so the
  // centroid fallback fires instead and the pin lands in the listing's
  // declared country.
  if (lat === 0 && lng === 0) return false;
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inline-SVG green pin via Leaflet's divIcon. Two styles:
 *   - precise: solid emerald-600 (#059669) — surveyed lat/lng
 *   - approx:  emerald-500 with a dashed outline — country centroid
 *     fallback. Different enough that a careful viewer can tell, but
 *     not noisy enough to distract on a sea of pins.
 *
 * Uses divIcon (not a remote PNG) so we don't depend on Leaflet's
 * default marker assets which break under bundlers.
 */
function makeGreenIcon(L: typeof import('leaflet'), precise: boolean) {
  const fill = '#059669';
  const stroke = precise ? '#065f46' : '#10b981';
  const strokeDasharray = precise ? '' : 'stroke-dasharray:2 2;';
  const html = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 32" width="24" height="32" style="filter:drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.35))"><path d="M12 0C5.4 0 0 5.4 0 12c0 7.7 9.6 18.5 11.1 20.1.5.5 1.3.5 1.8 0C14.4 30.5 24 19.7 24 12 24 5.4 18.6 0 12 0Z" fill="${fill}" stroke="${stroke}" style="stroke-width:1.5;${strokeDasharray}"/><circle cx="12" cy="12" r="4" fill="#ffffff"/></svg>`;
  return L.divIcon({
    html,
    className: 'aho-pin',
    iconSize: [24, 32],
    iconAnchor: [12, 32],
    popupAnchor: [0, -28],
  });
}
