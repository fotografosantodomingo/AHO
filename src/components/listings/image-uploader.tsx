'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

const MAX_IMAGES = 30;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

interface UploaderProps {
  propertyId: string;
  /** Title used to seed the alt-text for SEO + accessibility. Pass the
   *  EN title preferentially; falls back to ES if EN is empty. */
  titleEn: string | null;
  titleEs: string | null;
  city: string;
  /** Already-confirmed image count (server-rendered initial state). */
  initialCount: number;
}

type Status = 'pending' | 'uploading' | 'confirmed' | 'error';

interface UploadItem {
  /** Stable client-side ID; replaced by the server's imageId on POST. */
  clientId: string;
  imageId?: string;
  filename: string;
  size: number;
  status: Status;
  /** Local object-URL preview while uploading. */
  previewUrl: string;
  errorCode?: string;
}

/**
 * Property-image uploader.
 *
 * Two-step flow:
 *   1. POST /api/properties/{id}/images → returns presigned R2 URL + imageId.
 *   2. PUT bytes to R2.
 *   3. POST /api/properties/{id}/images/{imageId}/confirm with width/height.
 *
 * UI:
 *   - Drag-and-drop zone or click-to-pick.
 *   - Per-file thumbnail with state badge (pending / uploading / ✓ / error).
 *   - 30-image cap shown as N / 30; refuses extra files at the client.
 *   - Auto-fills alt text as `{title} — {city} — {index}` for SEO + a11y.
 *
 * R2-not-configured graceful path: when the sign endpoint returns
 * `503 r2_not_configured`, the uploader shows an inline notice instead of
 * a generic error. Until the PO opts R2 in, the API endpoints exist but
 * return that 503 — the UI explains what's happening.
 */
export function ImageUploader({
  propertyId,
  titleEn,
  titleEs,
  city,
  initialCount,
}: UploaderProps) {
  const t = useTranslations('imageUploader');
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [r2Disabled, setR2Disabled] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Total = previously-confirmed (initialCount) + items in this batch.
  // Cap check uses this total so users can't exceed 30 across batches.
  const totalSlots = initialCount + items.filter((i) => i.status !== 'error').length;
  const remaining = Math.max(0, MAX_IMAGES - totalSlots);
  const atCap = remaining === 0;

  const altBase = (titleEn || titleEs || '').trim() || 'listing';

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;

      // Filter out invalid before doing anything.
      const valid: File[] = [];
      for (const f of arr) {
        if (!ACCEPTED_TYPES.includes(f.type)) continue;
        if (f.size > MAX_FILE_BYTES) continue;
        valid.push(f);
      }

      // Truncate to remaining slots.
      const accepted = valid.slice(0, remaining);
      if (accepted.length === 0) return;

      const newItems: UploadItem[] = accepted.map((file, idx) => ({
        clientId: `${Date.now()}-${idx}-${file.name}`,
        filename: file.name,
        size: file.size,
        status: 'pending',
        previewUrl: URL.createObjectURL(file),
      }));
      setItems((prev) => [...prev, ...newItems]);

      // Process each file sequentially. Concurrent uploads might hit R2
      // rate limits or RLS race; sequential is safe and small N.
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i]!;
        const item = newItems[i]!;
        const positionIndex = initialCount + i + 1;
        const altText = `${altBase} — ${city} — ${positionIndex}`;
        await uploadOne(propertyId, file, item.clientId, altText, setItems, setR2Disabled);
      }

      // Refresh the page so server-rendered counters / sidebar reflect the
      // new image_count. The DB trigger updates properties.image_count
      // every time a property_images row is inserted/deleted.
      router.refresh();
    },
    [propertyId, altBase, city, initialCount, remaining, router],
  );

  function onSelectClick() {
    fileInputRef.current?.click();
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
    // Reset so the same file can be re-picked after error.
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('heading')}
        </p>
        <p className="text-sm tabular-nums">
          {totalSlots} <span className="text-helper">/ {MAX_IMAGES}</span>
        </p>
      </div>

      {r2Disabled && (
        <div
          role="status"
          className="rounded-card border border-warn/30 bg-warn-bg/40 p-4 text-sm text-warn"
        >
          {t('r2NotConfigured')}
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`rounded-card border-2 border-dashed p-8 text-center transition ${
          atCap
            ? 'cursor-not-allowed border-border-strong/30 bg-surface-muted/40'
            : dragOver
            ? 'border-action bg-action/5'
            : 'border-border-strong/40 bg-surface hover:border-border-strong/60 dark:bg-surface-deep'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          multiple
          disabled={atCap}
          onChange={onChange}
          className="sr-only"
        />
        <p className="font-brand text-base font-semibold">
          {atCap ? t('atCap') : t('dropHere')}
        </p>
        {!atCap && (
          <>
            <p className="mt-2 text-xs text-helper">{t('orClickHint')}</p>
            <button
              type="button"
              onClick={onSelectClick}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-border-strong px-4 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {t('selectFiles')}
            </button>
            <p className="mt-3 text-xs text-helper">{t('limits')}</p>
          </>
        )}
      </div>

      {items.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {items.map((item) => (
            <li
              key={item.clientId}
              className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep"
            >
              <div className="relative aspect-[4/3] bg-surface-muted dark:bg-surface-dark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.previewUrl}
                  alt={item.filename}
                  className="h-full w-full object-cover"
                />
                <span
                  className={`absolute left-2 top-2 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm ${
                    item.status === 'confirmed'
                      ? 'bg-emerald-100/90 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200'
                      : item.status === 'error'
                      ? 'bg-red-100/90 text-red-900 dark:bg-red-950/70 dark:text-red-200'
                      : 'bg-surface/90 text-ink dark:bg-surface-dark/90 dark:text-ink-inverse'
                  }`}
                >
                  {item.status === 'pending' && t('statusPending')}
                  {item.status === 'uploading' && t('statusUploading')}
                  {item.status === 'confirmed' && `✓ ${t('statusConfirmed')}`}
                  {item.status === 'error' && t('statusError')}
                </span>
              </div>
              <p className="truncate p-2 text-xs text-helper" title={item.filename}>
                {item.filename}
              </p>
              {item.errorCode && (
                <p className="px-2 pb-2 text-xs text-red-600">{item.errorCode}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function uploadOne(
  propertyId: string,
  file: File,
  clientId: string,
  altText: string,
  setItems: React.Dispatch<React.SetStateAction<UploadItem[]>>,
  setR2Disabled: React.Dispatch<React.SetStateAction<boolean>>,
) {
  // Step 1: sign upload + insert pending row.
  setItems((prev) =>
    prev.map((it) => (it.clientId === clientId ? { ...it, status: 'uploading' } : it)),
  );
  const signRes = await fetch(`/api/properties/${propertyId}/images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      byteSize: file.size,
      altTextEn: altText,
      altTextEs: altText,
    }),
  });
  if (!signRes.ok) {
    const body = await signRes.json().catch(() => ({}));
    if (body?.error === 'r2_not_configured') {
      setR2Disabled(true);
    }
    setItems((prev) =>
      prev.map((it) =>
        it.clientId === clientId
          ? { ...it, status: 'error', errorCode: body?.error ?? `http_${signRes.status}` }
          : it,
      ),
    );
    return;
  }
  const { imageId, uploadUrl, headers: putHeaders } = (await signRes.json()) as {
    imageId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };
  setItems((prev) =>
    prev.map((it) => (it.clientId === clientId ? { ...it, imageId } : it)),
  );

  // Step 2: PUT bytes to R2.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: file,
  });
  if (!putRes.ok) {
    setItems((prev) =>
      prev.map((it) =>
        it.clientId === clientId
          ? { ...it, status: 'error', errorCode: `r2_put_${putRes.status}` }
          : it,
      ),
    );
    return;
  }

  // Step 3: read dimensions client-side, then confirm.
  const dims = await readImageDimensions(file).catch(() => ({ width: 0, height: 0 }));
  if (dims.width === 0 || dims.height === 0) {
    setItems((prev) =>
      prev.map((it) =>
        it.clientId === clientId
          ? { ...it, status: 'error', errorCode: 'dimensions_failed' }
          : it,
      ),
    );
    return;
  }
  const confirmRes = await fetch(
    `/api/properties/${propertyId}/images/${imageId}/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ width: dims.width, height: dims.height }),
    },
  );
  if (!confirmRes.ok) {
    const body = await confirmRes.json().catch(() => ({}));
    setItems((prev) =>
      prev.map((it) =>
        it.clientId === clientId
          ? { ...it, status: 'error', errorCode: body?.error ?? `http_${confirmRes.status}` }
          : it,
      ),
    );
    return;
  }

  setItems((prev) =>
    prev.map((it) =>
      it.clientId === clientId ? { ...it, status: 'confirmed' } : it,
    ),
  );
}

function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_failed'));
    };
    img.src = url;
  });
}
