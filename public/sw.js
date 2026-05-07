// AHO Service Worker — v1 (installability + minimal navigation fallback).
//
// v1 goal: get the "Install AHO" prompt on Chrome / Edge / Samsung
// Internet so an agent can add the dashboard to their home screen and
// reach the voice-import flow in one tap. No precaching or aggressive
// runtime caching yet — those can fight Cloudflare's CDN cache and
// silently break auth flows if not tuned carefully.
//
// Future (out of scope for v1):
//   - Precache the dashboard shell + icons + manifest at install time.
//   - Background sync queue: if a voice recording fails to POST while
//     offline, persist the Blob in IndexedDB and submit on reconnect.
//   - Push notifications for new lead emails.
//
// Bump VERSION to force every existing SW to update on next page load.
// Old caches get purged on `activate` below.

const VERSION = 'aho-sw-v1';

self.addEventListener('install', (event) => {
  // skipWaiting so users get the new SW on first refresh, not after the
  // last tab closes. We're not pre-caching anything so there's no race.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean up stale caches from previous SW versions. Important now
      // because future versions WILL precache; setting up the cleanup
      // routine ahead of time means rolling out v2 doesn't ship dead
      // entries.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Pass-through fetch handler. Its mere presence (per Chrome's
// installability rules) is what flips the dashboard from "registered SW"
// to "installable PWA" — even with no caching logic. We deliberately do
// NOT intercept any responses here: the auth flow + Stripe + Supabase
// realtime depend on fresh-from-origin requests, and incorrect SW
// caching has bricked production sites for entire weeks.
self.addEventListener('fetch', () => {
  // intentionally empty — let the browser handle every request.
});
