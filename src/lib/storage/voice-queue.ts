/**
 * Browser-side IndexedDB queue for offline voice imports.
 *
 * The Content Hub flow (voice → Whisper → facts) demands working from
 * the field, where signal is unreliable. When the agent taps "Use this
 * recording" while offline (or the network blip swallows the multipart
 * POST), we persist the audio Blob + locale + draft metadata locally
 * and let the service worker drain the queue once we're back online.
 *
 * Why native IndexedDB and not `idb` / `dexie`:
 *   - One small queue, ~5 helpers — no need for a 10 KB dependency.
 *   - The SW also needs to read this store (no bundler in `public/sw.js`),
 *     so keeping the schema in pure browser-API JS is the simplest
 *     contract. The SW reimplements `listVoiceImports` / `dequeue` in
 *     plain JS using the same DB + store name + version below.
 *
 * Schema:
 *   - DB:    `aho-pwa`         (single-purpose; future PWA-side stores
 *                              can share the database, bumped versions)
 *   - Store: `voice-queue`     (keyPath `id`, autoIncrement off — we mint
 *                              ulid-ish ids ourselves so the SW can
 *                              reference items without race-y reads)
 *   - Version: 1
 *
 * Item shape (`QueuedItem`):
 *   {
 *     id:          string,           // `vq_<timestamp>_<rand>`
 *     blob:        Blob,             // structured-clone-stored
 *     mimeType:    string,           // mirror of blob.type for SW filename
 *     locale:      string,           // 2-letter agent UI locale
 *     metadata:    Record<string, unknown>,
 *     createdAt:   number,           // Date.now()
 *     attempts:    number,           // increments on each upload try
 *     lastError?:  string,
 *   }
 *
 * All helpers are no-ops when `indexedDB` is unavailable (server render,
 * older browsers without IDB). The page-side caller checks for support
 * before invoking; this layer additionally guards.
 */

const DB_NAME = 'aho-pwa';
const DB_VERSION = 1;
const STORE_NAME = 'voice-queue';

export interface QueuedVoiceItem {
  id: string;
  blob: Blob;
  mimeType: string;
  locale: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface EnqueueInput {
  blob: Blob;
  locale: string;
  metadata?: Record<string, unknown>;
}

function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isSupported()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    openDb().then(
      (db) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        Promise.resolve(fn(store))
          .then((result) => {
            tx.oncomplete = () => {
              db.close();
              resolve(result);
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error ?? new Error('IndexedDB tx error'));
            };
            tx.onabort = () => {
              db.close();
              reject(tx.error ?? new Error('IndexedDB tx aborted'));
            };
          })
          .catch((err) => {
            try {
              tx.abort();
            } catch {
              /* noop */
            }
            db.close();
            reject(err);
          });
      },
      (err) => reject(err),
    );
  });
}

function newId(): string {
  // ulid-ish: time-prefixed, monotonic enough for a single-tab queue.
  // We don't need crypto-grade uniqueness — collisions inside one
  // device's queue are vanishingly unlikely with ms + 6 base36 chars.
  const rand = Math.random().toString(36).slice(2, 8);
  return `vq_${Date.now().toString(36)}_${rand}`;
}

/**
 * Persist a voice recording for later upload. Returns the item id so
 * the caller can later show "queued" UI / cancel / inspect.
 */
export async function enqueueVoiceImport(
  input: EnqueueInput,
): Promise<string> {
  if (!isSupported()) throw new Error('IndexedDB unavailable');
  const item: QueuedVoiceItem = {
    id: newId(),
    blob: input.blob,
    mimeType: input.blob.type || 'audio/webm',
    locale: input.locale,
    metadata: input.metadata ?? {},
    createdAt: Date.now(),
    attempts: 0,
  };
  await withStore('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.add(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('add failed'));
    });
  });
  return item.id;
}

export async function dequeueVoiceImport(id: string): Promise<void> {
  if (!isSupported()) return;
  await withStore('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('delete failed'));
    });
  });
}

export async function listVoiceImports(): Promise<QueuedVoiceItem[]> {
  if (!isSupported()) return [];
  return withStore('readonly', (store) => {
    return new Promise<QueuedVoiceItem[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () =>
        resolve((req.result ?? []) as QueuedVoiceItem[]);
      req.onerror = () => reject(req.error ?? new Error('getAll failed'));
    });
  });
}

export async function incrementAttempts(
  id: string,
  lastError?: string,
): Promise<void> {
  if (!isSupported()) return;
  await withStore('readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as QueuedVoiceItem | undefined;
        if (!existing) {
          resolve();
          return;
        }
        const updated: QueuedVoiceItem = {
          ...existing,
          attempts: existing.attempts + 1,
          lastError,
        };
        const putReq = store.put(updated);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () =>
          reject(putReq.error ?? new Error('put failed'));
      };
      getReq.onerror = () =>
        reject(getReq.error ?? new Error('get failed'));
    });
  });
}

/**
 * Page-side fallback flusher. Used when the SW isn't available (older
 * browsers, fresh page load before SW activation) — POSTs each queued
 * item to /api/listings/voice-import directly. Returns counts for the
 * caller's toast / indicator.
 *
 * The SW does the same walk on `sync` / message events; whichever runs
 * first wins. In MVP we accept the (rare) duplicate-upload risk; a
 * `client_idempotency_key` hardening pass is in CONTENT_HUB_VISION
 * follow-up scope.
 */
export async function flushVoiceQueueFromPage(): Promise<{
  uploaded: number;
  failed: number;
  remaining: number;
}> {
  let uploaded = 0;
  let failed = 0;
  if (!isSupported()) return { uploaded, failed, remaining: 0 };

  const items = await listVoiceImports();
  for (const item of items) {
    const fd = new FormData();
    const ext = extFromMime(item.mimeType);
    fd.append(
      'file',
      new File([item.blob], `voice-${item.createdAt}.${ext}`, {
        type: item.mimeType,
      }),
      `voice-${item.createdAt}.${ext}`,
    );
    fd.append('locale', item.locale);
    try {
      const res = await fetch('/api/listings/voice-import', {
        method: 'POST',
        body: fd,
      });
      if (res.ok) {
        await dequeueVoiceImport(item.id);
        uploaded += 1;
      } else if (res.status >= 400 && res.status < 500) {
        // Permanent — drop after 3 attempts on the client side too.
        await incrementAttempts(item.id, `HTTP ${res.status}`);
        if (item.attempts + 1 >= 3) {
          await dequeueVoiceImport(item.id);
        }
        failed += 1;
      } else {
        await incrementAttempts(item.id, `HTTP ${res.status}`);
        if (item.attempts + 1 >= 5) {
          await dequeueVoiceImport(item.id);
        }
        failed += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await incrementAttempts(item.id, msg);
      failed += 1;
    }
  }
  const remaining = (await listVoiceImports()).length;
  return { uploaded, failed, remaining };
}

function extFromMime(mime: string): string {
  if (/webm/.test(mime)) return 'webm';
  if (/mp4|m4a/.test(mime)) return 'm4a';
  if (/mpeg/.test(mime)) return 'mp3';
  if (/wav/.test(mime)) return 'wav';
  if (/ogg/.test(mime)) return 'ogg';
  return 'webm';
}
