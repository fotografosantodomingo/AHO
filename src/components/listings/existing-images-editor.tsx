'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { buildImageUrl } from '@/lib/listings/image-url';

interface ExistingImage {
  id: string;
  cfImageId: string | null;
  r2Key: string;
  altTextEn: string | null;
  altTextEs: string | null;
  position: number;
  isPrimary: boolean;
}

interface Props {
  propertyId: string;
  images: ExistingImage[];
}

/**
 * Editor for alt-text on already-uploaded property photos.
 *
 * Renders one card per image with EN + ES alt-text inputs. On blur (or
 * Enter), the change is PATCHed to /api/properties/{id}/images/{imageId}
 * and a small ✓ / ✗ indicator confirms the round-trip. This is the
 * strong-image-SEO surface — agents writing descriptive alt text for
 * each photo (e.g. "Master bedroom with floor-to-ceiling windows facing
 * the ocean") is what makes the listing rank in Google Image Search.
 *
 * Why per-image vs a single dialog: per-image is the natural unit (you
 * see the photo + write its caption next to it). Bulk-edit dialogs are
 * tempting in code but agents abandon them because they can't see the
 * photos while writing.
 *
 * Saved state is server-truth — no optimistic local cache. If the PATCH
 * fails (network, RLS), we surface a red ✗ and the user re-tries on
 * next edit. The input retains its value either way.
 */
export function ExistingImagesEditor({ propertyId, images }: Props) {
  const t = useTranslations('imageEditor');

  if (images.length === 0) return null;

  return (
    <section className="space-y-3">
      <div>
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('heading')}
        </p>
        <p className="mt-1 text-sm text-helper">{t('hint')}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {images
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((img) => (
            <ImageRow key={img.id} image={img} propertyId={propertyId} />
          ))}
      </ul>
    </section>
  );
}

function ImageRow({
  image,
  propertyId,
}: {
  image: ExistingImage;
  propertyId: string;
}) {
  const t = useTranslations('imageEditor');
  const [altEn, setAltEn] = useState(image.altTextEn ?? '');
  const [altEs, setAltEs] = useState(image.altTextEs ?? '');
  const [savingEn, setSavingEn] = useState(false);
  const [savingEs, setSavingEs] = useState(false);
  const [statusEn, setStatusEn] = useState<'idle' | 'saved' | 'error'>('idle');
  const [statusEs, setStatusEs] = useState<'idle' | 'saved' | 'error'>('idle');

  async function save(lang: 'en' | 'es', value: string) {
    const setSaving = lang === 'en' ? setSavingEn : setSavingEs;
    const setStatus = lang === 'en' ? setStatusEn : setStatusEs;
    const originalValue = (lang === 'en' ? image.altTextEn : image.altTextEs) ?? '';
    if (value.trim() === originalValue.trim()) {
      setStatus('idle');
      return;
    }
    setSaving(true);
    setStatus('idle');
    try {
      const body =
        lang === 'en'
          ? { altTextEn: value.trim() || null }
          : { altTextEs: value.trim() || null };
      const res = await fetch(
        `/api/properties/${propertyId}/images/${image.id}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (res.ok && json.ok) {
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 1500);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  // Resolve the thumb URL. Prefers CF Images variant; falls back to R2
  // if CF Images isn't configured. Matches the gallery's resolution.
  const thumbUrl = buildImageUrl({
    cfImageId: image.cfImageId,
    r2Key: image.r2Key,
    variant: 'card',
  });

  return (
    <li className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep">
      <div className="flex gap-3 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl ?? ''}
          alt={altEn || altEs || ''}
          className="h-24 w-32 shrink-0 rounded-md object-cover"
          loading="lazy"
          decoding="async"
        />
        <div className="flex-1 space-y-2">
          {image.isPrimary && (
            <span className="inline-flex items-center rounded-full bg-action/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-action dark:bg-action-dark/15 dark:text-action-dark">
              {t('primaryBadge')}
            </span>
          )}
          <div>
            <label className="block text-[11px] font-medium text-helper">
              {t('altEnLabel')}
              {savingEn && <span className="ml-2 text-helper">…</span>}
              {statusEn === 'saved' && (
                <span className="ml-2 text-emerald-700 dark:text-emerald-300">✓</span>
              )}
              {statusEn === 'error' && (
                <span className="ml-2 text-red-700 dark:text-red-300">✗ {t('saveFailed')}</span>
              )}
            </label>
            <input
              type="text"
              value={altEn}
              onChange={(e) => setAltEn(e.target.value)}
              onBlur={() => save('en', altEn)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder={t('altEnPlaceholder')}
              maxLength={300}
              className="block w-full rounded-md border border-border-strong/40 bg-surface px-2 py-1 text-sm outline-hidden focus:ring-2 focus:ring-action dark:bg-surface-deep"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-helper">
              {t('altEsLabel')}
              {savingEs && <span className="ml-2 text-helper">…</span>}
              {statusEs === 'saved' && (
                <span className="ml-2 text-emerald-700 dark:text-emerald-300">✓</span>
              )}
              {statusEs === 'error' && (
                <span className="ml-2 text-red-700 dark:text-red-300">✗ {t('saveFailed')}</span>
              )}
            </label>
            <input
              type="text"
              value={altEs}
              onChange={(e) => setAltEs(e.target.value)}
              onBlur={() => save('es', altEs)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder={t('altEsPlaceholder')}
              maxLength={300}
              className="block w-full rounded-md border border-border-strong/40 bg-surface px-2 py-1 text-sm outline-hidden focus:ring-2 focus:ring-action dark:bg-surface-deep"
            />
          </div>
        </div>
      </div>
    </li>
  );
}
