import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/**
 * iOS apple-touch-icon — 180×180 PNG. Generated dynamically via
 * ImageResponse (Satori) so we don't have to commit a binary asset for
 * every viewport size. Mirrors the AHO mark used in `icon.svg` /
 * `icon-pwa.svg`: green square with a chunky "A" wordmark.
 *
 * Why this file exists: iOS Safari's "Add to Home Screen" pulls the
 * apple-touch-icon link tag (Next adds one automatically when this file
 * is present). Without it, iOS uses a screenshot of the page and the
 * launcher tile looks broken. The Web App Manifest's `icons[]` is read
 * by Chrome but not by iOS Safari at install time.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1d5a3c',
          color: '#fbf8f1',
          fontSize: 132,
          fontWeight: 700,
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
          letterSpacing: '-0.04em',
          // Slight optical baseline lift so the A's bowl sits at the
          // visual center, not the bounding-box center. Matches the
          // SVG version's hand-tuned y=354 on a 512 viewbox.
          paddingBottom: 14,
        }}
      >
        A
      </div>
    ),
    { ...size },
  );
}
