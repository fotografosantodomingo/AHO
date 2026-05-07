// AHO Service Worker — v2 (installability + offline navigation fallback).
//
// v1 goal: Chrome / Edge / Samsung Internet "Install AHO" prompt for the
//   on-the-move agent → reach voice-import in one tap.
// v2 (this file): when the installed PWA is opened with no signal,
//   serve a friendly offline page instead of Chrome's "No internet"
//   error dino. Strictly navigation-only — every other request still
//   goes straight to the network.
//
// Why we DO NOT runtime-cache anything else:
//   - Auth flows, Stripe, Supabase realtime all need fresh-from-origin
//     responses. Stale-while-revalidate has bricked production PWAs
//     for full weeks before.
//   - Cloudflare's CDN already does the right caching for static
//     `_next/static` chunks; layering a SW cache on top would just
//     fight the CDN.
//
// Bump VERSION to force every existing SW to update on next page load
// — the activate handler purges old caches on the next activation.

const VERSION = 'aho-sw-v2';
const OFFLINE_URL = '/offline.html';
const PRECACHE_URLS = [OFFLINE_URL, '/icon-pwa.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // Precache the offline shell + brand assets so the navigation
      // fallback works first time, even before the user has visited
      // any page on the deployed origin while online (e.g. they
      // installed the app and immediately went underground).
      const cache = await caches.open(VERSION);
      await cache.addAll(PRECACHE_URLS);
      // Activate immediately on first install. We're not pre-caching
      // anything dynamic so there's no race with in-flight requests.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge any old VERSION caches. Important now because future SW
      // versions WILL precache more aggressively; setting up the
      // cleanup routine ahead of time means rolling out v3 doesn't
      // ship dead entries that compete with the new ones.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only intercept top-level navigations (the user typed/tapped a URL
  // or refreshed the tab). Sub-resources, API calls, RSC payloads,
  // image fetches all fall through to the network — they'd surface
  // their own errors which the page can render, and the navigation
  // shell has already loaded by the time they fire.
  if (req.mode !== 'navigate') return;

  // GET-only. Form posts (e.g. auth POSTs) must always reach the
  // server; serving an offline page in their place would silently
  // swallow user input.
  if (req.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        // Always try the network first. Cloudflare's CDN handles its
        // own caching upstream of us; we only intervene on outright
        // failure (browser offline, DNS failure, TCP reset, etc.).
        const networkRes = await fetch(req);
        return networkRes;
      } catch (_err) {
        const cache = await caches.open(VERSION);
        const cached = await cache.match(OFFLINE_URL);
        return (
          cached ??
          new Response('You are offline.', {
            status: 503,
            headers: { 'content-type': 'text/plain;charset=UTF-8' },
          })
        );
      }
    })(),
  );
});
