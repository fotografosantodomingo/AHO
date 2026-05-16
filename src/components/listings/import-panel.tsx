'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ListingForm } from './listing-form';
import { AMENITY_KEYS, type AmenityKey } from '@/lib/listings/amenities';
import type { CreateListingInput } from '@/lib/listings/listing-schema';
import {
  enqueueVoiceImport,
  flushVoiceQueueFromPage,
  listVoiceImports,
} from '@/lib/storage/voice-queue';

interface ImportedFacts {
  detectedLanguage: string | null;
  titleEn: string | null;
  titleEs: string | null;
  descriptionEn: string | null;
  descriptionEs: string | null;
  transactionType: 'sale' | 'rent' | 'short_term' | null;
  propertyType: string | null;
  priceCents: number | null;
  currency: string | null;
  pricePeriod: 'total' | 'monthly' | 'weekly' | 'nightly' | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  yearBuilt: number | null;
  city: string | null;
  countryCode: string | null;
  neighborhood: string | null;
  postalCode: string | null;
  amenities: string[];
  photoUrls: string[];
  sourceUrl: string;
}

interface Props {
  successRedirectBase: string;
}

type Mode = 'choose' | 'manual' | 'imported';

/**
 * Day-5 + Day-6 import panel — three lanes for creating a new listing:
 *
 *   1. **URL**     — paste any portal listing → Claude scrape →
 *                    bilingual EN+ES title + description + facts.
 *   2. **Voice**   — record a 30s-3min voice note → Whisper STT →
 *                    Claude facts. Mobile-first workflow per the
 *                    Content Hub Vision.
 *   3. **Manual**  — skip both, fill the form blank like the
 *                    legacy flow.
 *
 * All three converge on the same `<ListingForm initialValues={...}>`
 * so the agent reviews + edits + saves through one familiar form.
 */
export function ImportPanel({ successRedirectBase }: Props) {
  const locale = useLocale();
  const t = useTranslations('importPanel');
  const [mode, setMode] = useState<Mode>('choose');
  const [facts, setFacts] = useState<ImportedFacts | null>(null);
  const [importMethod, setImportMethod] =
    useState<'url' | 'voice' | null>(null);

  // Manual mode renders straight ListingForm.
  if (mode === 'manual') {
    return <ListingForm successRedirectBase={successRedirectBase} />;
  }

  // Imported mode — show success banner + ListingForm pre-filled.
  if (mode === 'imported' && facts) {
    const initial = factsToFormDefaults(facts);
    // Cap matches the import-photos route (15 URLs/call, 30 cap on the
    // listing). Anything beyond can be uploaded manually after save.
    const photoUrlsToImport = facts.photoUrls.slice(0, 15);
    const truncated = facts.photoUrls.length - photoUrlsToImport.length;
    let bannerHeading: string;
    if (importMethod === 'voice') {
      bannerHeading = facts.detectedLanguage
        ? t('bannerVoiceWithLang', { lang: facts.detectedLanguage.toUpperCase() })
        : t('bannerVoiceNoLang');
    } else {
      bannerHeading = t('bannerUrl', { host: hostnameOf(facts.sourceUrl, t('voiceHost')) });
    }
    const photosKey = (() => {
      if (photoUrlsToImport.length === 0) return null;
      const isOne = photoUrlsToImport.length === 1;
      if (truncated > 0) {
        return t(isOne ? 'bannerPhotosFoundOfTotalOne' : 'bannerPhotosFoundOfTotalOther', {
          count: photoUrlsToImport.length,
          total: facts.photoUrls.length,
        });
      }
      return t(isOne ? 'bannerPhotosFoundOne' : 'bannerPhotosFoundOther', {
        count: photoUrlsToImport.length,
      });
    })();
    const truncatedCopy = truncated > 0
      ? t(truncated === 1 ? 'bannerPhotosTruncatedOne' : 'bannerPhotosTruncatedOther', { extra: truncated })
      : null;
    return (
      <div className="space-y-4">
        <div className="rounded-card border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-emerald-900 dark:text-emerald-200">
          <p className="font-semibold">{bannerHeading}</p>
          <p className="mt-1">
            {t('bannerReview')}
            {photosKey && <> {photosKey}</>}
            {truncatedCopy && <> {truncatedCopy}</>}
          </p>
        </div>
        <ListingForm
          key={facts.sourceUrl + (facts.detectedLanguage ?? '')}
          successRedirectBase={successRedirectBase}
          initialValues={initial}
          importedPhotoUrls={photoUrlsToImport}
        />
      </div>
    );
  }

  // Choose mode — both lanes side by side, plus a "fill manually" link.
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <UrlImportCard
          onSuccess={(f) => {
            setFacts(f);
            setImportMethod('url');
            setMode('imported');
          }}
        />
        <VoiceImportCard
          locale={locale}
          onSuccess={(f) => {
            setFacts(f);
            setImportMethod('voice');
            setMode('imported');
          }}
        />
      </div>
      <div className="text-center">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className="text-sm text-helper underline-offset-2 hover:text-ink hover:underline dark:hover:text-ink-inverse"
        >
          {t('skipManual')}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// URL lane
// =============================================================================

function UrlImportCard({ onSuccess }: { onSuccess: (f: ImportedFacts) => void }) {
  const t = useTranslations('importPanel');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/listings/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const raw = await res.text();
      type ApiResponse =
        | { facts: ImportedFacts }
        | { error: string; message?: string };
      let json: ApiResponse | null = null;
      try {
        json = JSON.parse(raw) as ApiResponse;
      } catch {
        setError(t('urlErrNotJson', { status: res.status }));
        return;
      }
      if (!res.ok || !json || !('facts' in json)) {
        const errCode =
          json && 'error' in json && typeof json.error === 'string' ? json.error : null;
        const errMsg =
          json && 'message' in json && typeof json.message === 'string' ? json.message : null;
        setError(translateUrlError(errCode, errMsg, res.status, t));
        return;
      }
      onSuccess(json.facts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex h-full flex-col rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep"
    >
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-helper">
          {t('urlEyebrow')}
        </p>
        <h2 className="mt-1 font-brand text-lg font-semibold tracking-tight">
          {t('urlHeading')}
        </h2>
        <p className="mt-1 text-xs text-helper">{t('urlSubheading')}</p>
      </header>
      <div className="flex flex-col gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          className="rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
          required
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={loading || url.trim().length === 0}
          className="btn-primary inline-flex h-10 items-center justify-center disabled:opacity-50"
        >
          {loading ? t('urlImporting') : t('urlImport')}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-card border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </form>
  );
}

type Translator = ReturnType<typeof useTranslations<'importPanel'>>;

function translateUrlError(
  code: string | null,
  raw: string | null | undefined,
  status: number,
  t: Translator,
): string {
  if (code === 'source_blocks_scraping') return t('urlErrSourceBlocks');
  if (code === 'invalid_url') return t('urlErrInvalid');
  if (code === 'internal_url') return t('urlErrInternal');
  if (code === 'fetch_failed') return t('urlErrFetch');
  if (code === 'extract_failed') return t('urlErrExtract');
  return raw ?? `HTTP ${status}`;
}

// =============================================================================
// Voice lane (Day 6)
// =============================================================================

function VoiceImportCard({
  locale,
  onSuccess,
}: {
  locale: string;
  onSuccess: (f: ImportedFacts) => void;
}) {
  const t = useTranslations('importPanel');
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshQueueCount = useCallback(async () => {
    try {
      const items = await listVoiceImports();
      setQueuedCount(items.length);
    } catch {
      /* IDB unavailable — keep 0 */
    }
  }, []);

  // Ask the SW to flush the queue. Works whether or not the SW is
  // controlling this page yet (postMessage is a no-op if no controller).
  const askSwToFlush = useCallback(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        reg.active?.postMessage({ type: 'aho:flush-voice-queue' });
        // Optional: register for periodic Background Sync where supported.
        // If the page-side path beats us to it that's fine.
        const syncReg = (reg as ServiceWorkerRegistration & {
          sync?: { register: (tag: string) => Promise<void> };
        }).sync;
        if (syncReg) {
          syncReg.register('aho-voice-queue').catch(() => {
            /* sync API can reject without permission — ignore */
          });
        }
      })
      .catch(() => {
        /* no SW — page-side fallback below covers it */
      });
  }, []);

  // Surface SW broadcast messages back into the panel, and re-render
  // the queued counter / clear the inline notice when items drain.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; uploaded?: number; remaining?: number }
        | null;
      if (!data || typeof data !== 'object') return;
      if (
        data.type === 'aho:voice-queue-flushed' ||
        data.type === 'aho:voice-queue-uploaded' ||
        data.type === 'aho:voice-queue-dropped'
      ) {
        void refreshQueueCount();
        if (
          data.type === 'aho:voice-queue-flushed' &&
          typeof data.uploaded === 'number' &&
          data.uploaded > 0
        ) {
          setQueuedNotice(
            t(
              data.uploaded === 1 ? 'voiceQueuedUploadedOne' : 'voiceQueuedUploadedOther',
              { count: data.uploaded },
            ),
          );
        } else if (
          // Queue fully drained (remaining = 0) and we didn't already
          // overwrite the notice with an "uploaded" message above.
          // Clears the stale "Saved — we'll upload this when you're back
          // online" banner that previously persisted forever after the
          // SW silently drained the queue (#37).
          typeof data.remaining === 'number' &&
          data.remaining === 0
        ) {
          setQueuedNotice(null);
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [refreshQueueCount, t]);

  // On mount: count any recordings left in IDB from a previous session,
  // then attempt a flush via the SW + a page-side fallback flush in
  // parallel. Whichever path completes first wins; duplicates are rare
  // and tolerated in MVP (see CONTENT_HUB_VISION follow-up scope).
  useEffect(() => {
    void refreshQueueCount();
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      askSwToFlush();
      void flushVoiceQueueFromPage().then(refreshQueueCount).catch(() => {
        /* swallow — IDB or network may be unavailable */
      });
    }
    const onOnline = () => {
      askSwToFlush();
      void flushVoiceQueueFromPage().then(refreshQueueCount).catch(() => {
        /* swallow */
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [askSwToFlush, refreshQueueCount]);

  // Detect browser support upfront so we can show a fallback message.
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      !(navigator.mediaDevices && typeof window.MediaRecorder !== 'undefined')
    ) {
      setUnsupported(true);
    }
  }, []);

  // Revoke any object URL on unmount so it doesn't leak.
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [audioUrl]);

  async function startRecording(): Promise<void> {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Some Safari builds need 'audio/mp4' explicitly; webm is best
      // supported elsewhere. Default to whatever the browser picks.
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const type = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        setAudioBlob(blob);
        setAudioUrl((u) => {
          if (u) URL.revokeObjectURL(u);
          return URL.createObjectURL(blob);
        });
        // Stop mic immediately so the browser tab doesn't hold it.
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      startedAtRef.current = Date.now();
      setRecordingMs(0);
      tickRef.current = setInterval(() => {
        setRecordingMs(Date.now() - startedAtRef.current);
      }, 250);
    } catch (e) {
      setError(
        e instanceof Error
          ? t('voiceErrMicAccess', { message: e.message })
          : t('voiceErrMicAccessNoMsg'),
      );
    }
  }

  function stopRecording(): void {
    const mr = mediaRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setRecording(false);
  }

  function reset(): void {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingMs(0);
    setError(null);
  }

  async function queueRecording(blob: Blob, reason: 'offline' | 'fetch-failed'): Promise<void> {
    try {
      await enqueueVoiceImport({
        blob,
        locale,
        metadata: { reason, capturedAt: Date.now() },
      });
      await refreshQueueCount();
      setQueuedNotice(
        t(reason === 'offline' ? 'voiceQueuedOffline' : 'voiceQueuedFetchFailed'),
      );
      setAudioBlob(null);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setRecordingMs(0);
      // Pre-emptively register a sync so the SW gets a wake-up when
      // we're back on the network, even if the user closes the tab.
      askSwToFlush();
    } catch (e) {
      // Last-resort: if IDB itself failed (private mode, full disk),
      // we can't queue. Surface the underlying error so the agent can
      // try again or copy the audio elsewhere.
      setError(
        t('voiceErrIdb', { message: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  async function submit(): Promise<void> {
    if (!audioBlob) return;
    setLoading(true);
    setError(null);
    setQueuedNotice(null);

    // Detect offline upfront — skip the fetch entirely so we don't
    // burn a few seconds on an inevitable failure.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await queueRecording(audioBlob, 'offline');
      setLoading(false);
      return;
    }

    try {
      const fd = new FormData();
      const filename = `voice-${Date.now()}.${extFor(audioBlob.type)}`;
      fd.append('file', audioBlob, filename);
      fd.append('locale', locale);
      let res: Response;
      try {
        res = await fetch('/api/listings/voice-import', {
          method: 'POST',
          body: fd,
        });
      } catch (networkErr) {
        // TypeError from fetch = network died mid-request. Queue
        // instead of erroring, same UX as offline-at-submit.
        await queueRecording(audioBlob, 'fetch-failed');
        setLoading(false);
        // Avoid console-spamming production; only log once.
        if (typeof console !== 'undefined') {
          console.warn('[voice-import] queued after fetch failure', networkErr);
        }
        return;
      }
      const raw = await res.text();
      type ApiResponse =
        | { facts: ImportedFacts; transcript: string }
        | { error: string; message?: string };
      let json: ApiResponse | null = null;
      try {
        json = JSON.parse(raw) as ApiResponse;
      } catch {
        setError(t('voiceErrNotJson', { status: res.status }));
        return;
      }
      if (!res.ok || !json || !('facts' in json)) {
        const errCode =
          json && 'error' in json && typeof json.error === 'string' ? json.error : null;
        const errMsg =
          json && 'message' in json && typeof json.message === 'string' ? json.message : null;
        // 5xx? Treat like a transient fault — queue for retry rather
        // than dead-ending the agent. 4xx (validation, file-too-large)
        // we surface immediately; queueing wouldn't fix them.
        if (res.status >= 500) {
          await queueRecording(audioBlob, 'fetch-failed');
          return;
        }
        setError(translateVoiceError(errCode, errMsg, res.status, t));
        return;
      }
      onSuccess(json.facts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (unsupported) {
    return (
      <div className="rounded-card border border-border bg-surface p-5 dark:bg-surface-deep">
        <p className="text-xs font-semibold uppercase tracking-wider text-helper">
          {t('voiceEyebrow')}
        </p>
        <h2 className="mt-1 font-brand text-lg font-semibold tracking-tight">
          {t('voiceHeading')}
        </h2>
        <p className="mt-2 text-sm text-helper">{t('voiceUnsupportedBody')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-card border border-border bg-surface p-5 shadow-whisper dark:bg-surface-deep">
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-helper">
          {t('voiceEyebrow')}
        </p>
        <h2 className="mt-1 font-brand text-lg font-semibold tracking-tight">
          {t('voiceHeading')}
        </h2>
        <p className="mt-1 text-xs text-helper">{t('voiceSubheading')}</p>
        {queuedCount > 0 && (
          <p
            className="mt-2 rounded-card border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-800 dark:text-amber-300"
            aria-live="polite"
          >
            {t(
              queuedCount === 1 ? 'voiceQueuedCountOne' : 'voiceQueuedCountOther',
              { count: queuedCount },
            )}
          </p>
        )}
      </header>

      {!audioBlob ? (
        <div className="flex flex-col gap-2">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              className="btn-primary inline-flex h-10 items-center justify-center"
            >
              {t('voiceStart')}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex h-10 items-center justify-center rounded-full bg-red-600 px-5 text-sm font-medium text-white transition hover:bg-red-700"
            >
              {t('voiceStop', { time: formatMs(recordingMs) })}
            </button>
          )}
          {recording && (
            <p className="text-center text-xs text-helper">
              {t('voiceRecordingHint')}
            </p>
          )}
          {!recording && (
            <p className="text-center text-xs text-helper">{t('voiceIdleTip')}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <audio
            controls
            src={audioUrl ?? undefined}
            className="w-full rounded-md"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="btn-primary inline-flex h-10 items-center justify-center disabled:opacity-50"
            >
              {loading ? t('voiceTranscribing') : t('voiceUseRecording')}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:bg-surface-deep dark:hover:bg-white/5"
            >
              {t('voiceReRecord')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-card border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {queuedNotice && !error && (
        <p
          className="mt-3 rounded-card border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300"
          aria-live="polite"
        >
          {queuedNotice}
        </p>
      )}
    </div>
  );
}

function translateVoiceError(
  code: string | null,
  raw: string | null | undefined,
  status: number,
  t: Translator,
): string {
  if (code === 'transcription_failed') return t('voiceErrTranscription');
  if (code === 'file_too_large') return t('voiceErrTooLarge');
  if (code === 'voice_extract_failed') return t('voiceErrExtract');
  if (code === 'unsupported_audio_type') return t('voiceErrUnsupportedAudio');
  return raw ?? `HTTP ${status}`;
}

function extFor(mimeType: string): string {
  if (/webm/.test(mimeType)) return 'webm';
  if (/mp4|m4a/.test(mimeType)) return 'm4a';
  if (/mpeg/.test(mimeType)) return 'mp3';
  if (/wav/.test(mimeType)) return 'wav';
  if (/ogg/.test(mimeType)) return 'ogg';
  return 'webm';
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// =============================================================================
// Shared facts → form defaults (URL + Voice both end up here)
// =============================================================================

function factsToFormDefaults(facts: ImportedFacts): Partial<CreateListingInput> {
  const filteredAmenities: AmenityKey[] = [];
  const lowered = (facts.amenities ?? []).map((a) => a.toLowerCase());
  for (const key of AMENITY_KEYS) {
    if (lowered.some((a) => a.includes(key.replace('_', ' ')) || a.includes(key))) {
      filteredAmenities.push(key);
    }
  }
  return {
    title_en: facts.titleEn ?? null,
    title_es: facts.titleEs ?? null,
    description_en: facts.descriptionEn ?? null,
    description_es: facts.descriptionEs ?? null,
    transaction_type: facts.transactionType ?? 'sale',
    property_type: (facts.propertyType ?? 'apartment').toLowerCase(),
    price_cents: facts.priceCents ?? undefined,
    currency: (facts.currency ?? 'USD').toUpperCase(),
    price_period: facts.pricePeriod ?? null,
    bedrooms: facts.bedrooms ?? null,
    bathrooms: facts.bathrooms ?? null,
    area_sqm: facts.areaSqm ?? null,
    city: facts.city ?? '',
    country_code: (facts.countryCode ?? '').toUpperCase(),
    neighborhood: facts.neighborhood ?? null,
    postal_code: facts.postalCode ?? null,
    display_address: true,
    amenities: filteredAmenities,
  };
}

function hostnameOf(u: string, voiceLabel: string): string {
  if (u.startsWith('voice:')) return voiceLabel;
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}
