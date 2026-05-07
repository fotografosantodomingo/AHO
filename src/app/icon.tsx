import { ImageResponse } from 'next/og';

// Next.js App Router convention — `icon.tsx` at the route root emits
// the favicon. Generated as a small (32×32) PNG via the Edge runtime
// at request time. Solves the Lighthouse 'errors-in-console' 404 on
// /favicon.ico flagged 2026-05-07.

export const runtime = 'edge';
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1d5a3c',
          color: '#fbf8f1',
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        A
      </div>
    ),
    { ...size },
  );
}
