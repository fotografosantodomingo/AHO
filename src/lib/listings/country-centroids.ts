/**
 * Country centroids — approximate `[latitude, longitude]` per ISO 3166-1
 * alpha-2 code. Used as a low-fidelity fallback for the search map: a
 * listing with no precise lat/lng still gets pinned at the country
 * centroid so the map isn't empty when agents haven't entered exact
 * coordinates yet.
 *
 * Sourced from public-domain geographic centers / capital approximations.
 * These are NOT survey-grade — they only need to be inside the country
 * for the visual hint. A precise per-listing lat/lng (entered in the
 * listing form, optionally) always wins over the fallback.
 *
 * Coverage prioritizes markets where agents are most likely to list:
 * Latin America, Europe, North America, key Asia. Add codes as new
 * countries onboard agents.
 */

export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  // Americas
  AR: [-38.4161, -63.6167],
  BR: [-14.235, -51.9253],
  CA: [56.1304, -106.3468],
  CL: [-35.6751, -71.543],
  CO: [4.5709, -74.2973],
  CR: [9.7489, -83.7534],
  DO: [18.7357, -70.1627],
  EC: [-1.8312, -78.1834],
  GT: [15.7835, -90.2308],
  HN: [15.2, -86.2419],
  MX: [23.6345, -102.5528],
  NI: [12.8654, -85.2072],
  PA: [8.538, -80.7821],
  PE: [-9.19, -75.0152],
  PR: [18.2208, -66.5901],
  PY: [-23.4425, -58.4438],
  SV: [13.7942, -88.8965],
  US: [37.0902, -95.7129],
  UY: [-32.5228, -55.7658],
  VE: [6.4238, -66.5897],
  // Europe
  AT: [47.5162, 14.5501],
  BE: [50.5039, 4.4699],
  BG: [42.7339, 25.4858],
  CH: [46.8182, 8.2275],
  CZ: [49.8175, 15.473],
  DE: [51.1657, 10.4515],
  DK: [56.2639, 9.5018],
  EE: [58.5953, 25.0136],
  ES: [40.4637, -3.7492],
  FI: [61.9241, 25.7482],
  FR: [46.6034, 1.8883],
  GB: [55.3781, -3.436],
  GR: [39.0742, 21.8243],
  HR: [45.1, 15.2],
  HU: [47.1625, 19.5033],
  IE: [53.4129, -8.2439],
  IT: [41.8719, 12.5674],
  LT: [55.1694, 23.8813],
  LV: [56.8796, 24.6032],
  NL: [52.1326, 5.2913],
  NO: [60.472, 8.4689],
  PL: [51.9194, 19.1451],
  PT: [39.3999, -8.2245],
  RO: [45.9432, 24.9668],
  SE: [60.1282, 18.6435],
  SI: [46.1512, 14.9955],
  SK: [48.669, 19.699],
  TR: [38.9637, 35.2433],
  UA: [48.3794, 31.1656],
  // Asia
  AE: [23.4241, 53.8478],
  CN: [35.8617, 104.1954],
  HK: [22.3193, 114.1694],
  ID: [-0.7893, 113.9213],
  IL: [31.0461, 34.8516],
  IN: [20.5937, 78.9629],
  JP: [36.2048, 138.2529],
  KR: [35.9078, 127.7669],
  MY: [4.2105, 101.9758],
  PH: [12.8797, 121.774],
  SA: [23.8859, 45.0792],
  SG: [1.3521, 103.8198],
  TH: [15.87, 100.9925],
  TW: [23.6978, 120.9605],
  VN: [14.0583, 108.2772],
  // Africa + Oceania
  AU: [-25.2744, 133.7751],
  EG: [26.0975, 31.0436],
  KE: [-0.0236, 37.9062],
  MA: [31.7917, -7.0926],
  NG: [9.082, 8.6753],
  NZ: [-40.9006, 174.886],
  ZA: [-30.5595, 22.9375],
};

export function countryCentroid(
  countryCode: string | null | undefined,
): [number, number] | null {
  if (!countryCode) return null;
  return COUNTRY_CENTROIDS[countryCode.toUpperCase()] ?? null;
}
