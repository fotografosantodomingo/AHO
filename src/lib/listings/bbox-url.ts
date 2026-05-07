/**
 * Bbox URL-param encoding for the /search map view.
 *
 * The search page is a Server Component for the LCP win — initial paint
 * comes from the server-rendered `searchListings()` result. We don't want
 * the panned-map view to invalidate that initial render, so the bbox
 * state lives in URL via `history.replaceState` (shallow update, no
 * Next.js router push, no Server Component re-run).
 *
 * Format: `?bbox=swLat,swLng,neLat,neLng,zoom` — five comma-separated
 * numbers. Five fields not four because `zoom` controls whether the
 * bbox endpoint includes no-coord listings (country-overview mode at
 * zoom < 6). Without the zoom field, a shared link at zoom 3 would
 * silently fail to surface the country-centroid pins.
 *
 * Why a single comma-joined param instead of five separate params:
 *   - Shorter URLs (one ?bbox= vs ?sw_lat=&sw_lng=&ne_lat=&ne_lng=&zoom=)
 *   - Tells humans reading the URL "this is one thing, the map view"
 *     rather than five filter knobs
 *   - The bbox endpoint internally still uses sw_lat etc. — this helper
 *     bridges the two representations
 *
 * Validation rejects:
 *   - non-finite numbers
 *   - lat |x| > 90, lng |x| > 180
 *   - sw > ne (south-west must be south & west of north-east)
 *   - zoom outside [0, 20]
 *
 * Lossy round-trip: latitudes/longitudes are clamped to 5 decimal places
 * (~1.1m precision at the equator — far below map-pan resolution) so a
 * pan of e.g. (40.71234567, -74.00543210) → "40.71235,-74.00543". Keeps
 * URLs readable and stable across consecutive moveend events that landed
 * on essentially the same view.
 */

export interface BboxView {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
  zoom: number;
}

const PRECISION = 5;

function isValidLat(n: number): boolean {
  return Number.isFinite(n) && n >= -90 && n <= 90;
}

function isValidLng(n: number): boolean {
  return Number.isFinite(n) && n >= -180 && n <= 180;
}

function isValidZoom(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 20;
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Encode a bbox view as a single comma-joined string suitable for use as
 * a URL query-param value. Returns `null` for invalid input rather than
 * throwing — callers should treat this as "don't include the param".
 */
export function encodeBbox(view: BboxView): string | null {
  if (!isValidLat(view.swLat) || !isValidLat(view.neLat)) return null;
  if (!isValidLng(view.swLng) || !isValidLng(view.neLng)) return null;
  if (!isValidZoom(view.zoom)) return null;
  if (view.swLat > view.neLat || view.swLng > view.neLng) return null;
  return [
    round(view.swLat, PRECISION),
    round(view.swLng, PRECISION),
    round(view.neLat, PRECISION),
    round(view.neLng, PRECISION),
    Math.round(view.zoom),
  ].join(',');
}

/**
 * Parse a comma-joined `?bbox=` value back into a BboxView. Returns
 * `null` for any invalid input (wrong arity, non-numeric, out of range,
 * inverted corners). Callers should treat null as "the param is bogus,
 * ignore it" — never throw, never partially trust.
 */
export function parseBbox(raw: string | null | undefined): BboxView | null {
  if (!raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 5) return null;
  const [swLatS, swLngS, neLatS, neLngS, zoomS] = parts;
  const swLat = Number(swLatS);
  const swLng = Number(swLngS);
  const neLat = Number(neLatS);
  const neLng = Number(neLngS);
  const zoom = Number(zoomS);
  if (!isValidLat(swLat) || !isValidLat(neLat)) return null;
  if (!isValidLng(swLng) || !isValidLng(neLng)) return null;
  if (!isValidZoom(zoom)) return null;
  if (swLat > neLat || swLng > neLng) return null;
  return { swLat, swLng, neLat, neLng, zoom };
}
