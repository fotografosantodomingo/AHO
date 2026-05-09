// AHO Service Worker — v3 (installability + offline navigation fallback
// + offline voice-import queue drain).
//
// v1 goal: Chrome / Edge / Samsung Internet "Install AHO" prompt for the
//   on-the-move agent → reach voice-import in one tap.
// v2: when the installed PWA is opened with no signal, serve a friendly
//   offline page instead of Chrome's "No internet" error dino. Strictly
//   navigation-only — every other request still goes straight to the
//   network.
// v3 (this file): when the page is offline OR a multipart POST to
//   /api/listings/voice-import fails, the page persists the recording
//   to IndexedDB (`aho-pwa` / `voice-queue`). On reconnect the page
//   fires a `{ type: 'aho:flush-voice-queue' }` message OR the browser
//   triggers a `sync` event (when the page registered one) — either
//   path lands in `flushVoiceQueue()` below, which walks the store and
//   POSTs each item.
//
// Why we DO NOT runtime-cache anything else:
//   - Auth flows, Stripe, Supabase realtime all need fresh-from-origin
//     responses. Stale-while-revalidate has bricked production PWAs
//     for full weeks before.
//   - Cloudflare's CDN already does the right caching for static
//     `_next/static` chunks; layering a SW cache on top would just
//     fight the CDN.
//
// IndexedDB schema mirrored from src/lib/storage/voice-queue.ts:
//   DB:    'aho-pwa', version 1
//   Store: 'voice-queue', keyPath 'id'
//   Item:  { id, blob, mimeType, locale, metadata, createdAt, attempts, lastError? }
// Keep the two in sync — bumping DB_VERSION here without bumping the TS
// helper (or vice versa) will break the migration handshake.
//
// Bump VERSION to force every existing SW to update on next page load
// — the activate handler purges old caches on the next activation.

const VERSION = 'aho-sw-v3';
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

// =============================================================================
// Voice-queue drain
// =============================================================================
//
// Trigger paths:
//   1. Background Sync API: page calls `registration.sync.register('aho-voice-queue')`
//      → browser fires `sync` event when online. Chromium-only; degrades
//      gracefully when unavailable.
//   2. Manual flush: page posts `{ type: 'aho:flush-voice-queue' }` on
//      `online` events / panel mount. Works in every browser with SW
//      support.
//
// Both paths land in `flushVoiceQueue()`. The function is idempotent
// against in-flight calls because the store delete happens before we
// move to the next item; concurrent flushes might double-POST a single
// item in a worst-case race, which the server tolerates (creates two
// drafts — agent reviews and discards the duplicate).

const VOICE_DB = 'aho-pwa';
const VOICE_DB_VERSION = 1;
const VOICE_STORE = 'voice-queue';
const VOICE_ENDPOINT = '/api/listings/voice-import';
const MAX_ATTEMPTS_4XX = 3;
const MAX_ATTEMPTS_5XX = 5;

function openVoiceDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VOICE_DB, VOICE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(VOICE_STORE)) {
        db.createObjectStore(VOICE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('open failed'));
  });
}

function listQueue(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOICE_STORE, 'readonly');
    const req = tx.objectStore(VOICE_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error('getAll failed'));
  });
}

function deleteFromQueue(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOICE_STORE, 'readwrite');
    const req = tx.objectStore(VOICE_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('delete failed'));
  });
}

function bumpAttempts(db, id, lastError) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOICE_STORE, 'readwrite');
    const store = tx.objectStore(VOICE_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result;
      if (!item) return resolve();
      item.attempts = (item.attempts || 0) + 1;
      if (lastError) item.lastError = lastError;
      const putReq = store.put(item);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error || new Error('put failed'));
    };
    getReq.onerror = () => reject(getReq.error || new Error('get failed'));
  });
}

function extFromMime(mime) {
  if (/webm/.test(mime)) return 'webm';
  if (/mp4|m4a/.test(mime)) return 'm4a';
  if (/mpeg/.test(mime)) return 'mp3';
  if (/wav/.test(mime)) return 'wav';
  if (/ogg/.test(mime)) return 'ogg';
  return 'webm';
}

async function uploadOne(item) {
  const fd = new FormData();
  const ext = extFromMime(item.mimeType || 'audio/webm');
  const file = new File(
    [item.blob],
    `voice-${item.createdAt}.${ext}`,
    { type: item.mimeType || 'audio/webm' },
  );
  fd.append('file', file, `voice-${item.createdAt}.${ext}`);
  fd.append('locale', item.locale || 'en');
  const res = await fetch(VOICE_ENDPOINT, { method: 'POST', body: fd });
  return res;
}

async function broadcast(message) {
  const clientsList = await self.clients.matchAll({
    includeUncontrolled: true,
    type: 'window',
  });
  for (const client of clientsList) {
    client.postMessage(message);
  }
}

async function flushVoiceQueue() {
  let db;
  try {
    db = await openVoiceDb();
  } catch (e) {
    return { uploaded: 0, failed: 0, remaining: 0 };
  }
  const items = await listQueue(db);
  let uploaded = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const res = await uploadOne(item);
      if (res.ok) {
        await deleteFromQueue(db, item.id);
        uploaded += 1;
        // Surface success to any open page so it can show the
        // import-result toast as if the upload had happened live.
        let payload = null;
        try {
          payload = await res.clone().json();
        } catch (_e) {
          /* server returned non-JSON; toast still shows generic success */
        }
        await broadcast({
          type: 'aho:voice-queue-uploaded',
          id: item.id,
          result: payload,
        });
      } else if (res.status >= 400 && res.status < 500) {
        await bumpAttempts(db, item.id, `HTTP ${res.status}`);
        if ((item.attempts || 0) + 1 >= MAX_ATTEMPTS_4XX) {
          await deleteFromQueue(db, item.id);
          await broadcast({
            type: 'aho:voice-queue-dropped',
            id: item.id,
            reason: `HTTP ${res.status}`,
          });
        }
        failed += 1;
      } else {
        await bumpAttempts(db, item.id, `HTTP ${res.status}`);
        if ((item.attempts || 0) + 1 >= MAX_ATTEMPTS_5XX) {
          await deleteFromQueue(db, item.id);
          await broadcast({
            type: 'aho:voice-queue-dropped',
            id: item.id,
            reason: `HTTP ${res.status}`,
          });
        }
        failed += 1;
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      try {
        await bumpAttempts(db, item.id, msg);
      } catch (_inner) {
        /* swallow — DB state may be transient (offline mid-flush) */
      }
      failed += 1;
      // Network error: don't drop. Throwing inside a sync handler tells
      // the browser to retry the sync event later (Chromium honors this).
      if (failed === items.length) throw e;
    }
  }
  const remaining = (await listQueue(db)).length;
  db.close();
  await broadcast({
    type: 'aho:voice-queue-flushed',
    uploaded,
    failed,
    remaining,
  });
  return { uploaded, failed, remaining };
}

self.addEventListener('sync', (event) => {
  if (event.tag !== 'aho-voice-queue') return;
  event.waitUntil(flushVoiceQueue());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'aho:flush-voice-queue') {
    event.waitUntil(flushVoiceQueue());
  }
});
