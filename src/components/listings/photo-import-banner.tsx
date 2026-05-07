'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';

/**
 * Photo-import result banner shown on the listing edit page after the
 * URL/voice import flow saves a draft and runs server-side photo
 * migration (POST /api/properties/:id/import-photos).
 *
 * Why this component exists: the form submits the draft, fires the
 * import-photos call, then redirects. The redirect blows away the
 * in-memory result, so the user lands on the edit page seeing only
 * however many photos succeeded — with no signal that the others
 * silently failed (CDN block, oversize, timeout, etc.). They might
 * reasonably assume those photos just don't exist on the source.
 *
 * Mechanism: sessionStorage handoff.
 *   - `listing-form.tsx` writes `aho:photo-import-result:{propertyId}`
 *     immediately before `router.push(...)`.
 *   - This component reads + clears it on mount, then renders the
 *     banner if there's something worth saying.
 *
 * Why sessionStorage and not a `?photoImport=...` URL param: keeps the
 * detail-page URL clean. A URL param would survive copy-paste and
 * bookmark, leaving stale "5 photos imported" notices in places they
 * make no sense. sessionStorage scopes to the tab, survives a quick
 * refresh, and dies when the tab closes — exactly the lifetime we
 * want for a one-shot post-action notification.
 */

interface ImportResultEntry {
  url: string;
  ok: boolean;
  errorCode?: string;
}

interface ImportResultPayload {
  imported: number;
  failed: number;
  skipped: number;
  total: number;
  results?: ImportResultEntry[];
}

const STORAGE_PREFIX = 'aho:photo-import-result:';
const UPLOADER_ANCHOR_ID = 'photo-uploader';

interface Props {
  propertyId: string;
}

export function PhotoImportBanner({ propertyId }: Props) {
  const locale = useLocale();
  const [payload, setPayload] = useState<ImportResultPayload | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Read + clear the sessionStorage handoff on mount. We clear
  // immediately so a later refresh of the same page doesn't re-show the
  // banner — this is a strictly one-shot notification.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = `${STORAGE_PREFIX}${propertyId}`;
    let raw: string | null = null;
    try {
      raw = window.sessionStorage.getItem(key);
    } catch {
      // sessionStorage can throw in private browsing or with quota
      // exceeded — silently skip; the banner just won't render.
      return;
    }
    if (!raw) return;
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    try {
      const parsed = JSON.parse(raw) as ImportResultPayload;
      // Sanity-check: at least one of imported/failed must be > 0 to
      // bother showing the banner. Skipped-only is a no-op for the user.
      if (
        typeof parsed.imported === 'number' &&
        typeof parsed.failed === 'number' &&
        (parsed.imported > 0 || parsed.failed > 0)
      ) {
        setPayload(parsed);
      }
    } catch {
      /* ignore malformed payloads */
    }
  }, [propertyId]);

  if (!payload || dismissed) return null;

  const { imported, failed, results } = payload;

  // Tone selection. Green = pure success, amber = partial, red = total
  // failure. Matches the badge colors used by the staged-photo uploader
  // and the existing connect-meta-section flash banners.
  const tone: 'success' | 'warn' | 'error' =
    imported > 0 && failed === 0
      ? 'success'
      : imported > 0 && failed > 0
      ? 'warn'
      : 'error';

  const toneClass = {
    success:
      'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',
    warn:
      'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200',
    error:
      'border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-200',
  }[tone];

  const dismissBorderClass = {
    success: 'border-emerald-500/40 hover:bg-emerald-500/10',
    warn: 'border-amber-500/40 hover:bg-amber-500/10',
    error: 'border-red-500/40 hover:bg-red-500/10',
  }[tone];

  function handleScrollToUploader() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(UPLOADER_ANCHOR_ID);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setDismissed(true);
  }

  // EN+ES inline copy — matches the inline-bilingual pattern used by
  // listing-form.tsx for transient UI strings (other 5 locales fall
  // back to EN, same as the rest of the dashboard chrome).
  const isEs = locale === 'es';
  const headline =
    tone === 'success'
      ? isEs
        ? `${imported} foto${imported === 1 ? '' : 's'} importada${imported === 1 ? '' : 's'}`
        : `${imported} photo${imported === 1 ? '' : 's'} imported`
      : tone === 'warn'
      ? isEs
        ? `${imported} importada${imported === 1 ? '' : 's'}, ${failed} omitida${failed === 1 ? '' : 's'}`
        : `${imported} imported, ${failed} skipped`
      : isEs
      ? 'No se pudo importar ninguna foto'
      : "Couldn't import any photos";

  const explainer =
    tone === 'success'
      ? isEs
        ? 'Todas las fotos del listado de origen se importaron correctamente.'
        : 'All photos from the source listing were imported successfully.'
      : tone === 'warn'
      ? isEs
        ? `Algunas fotos no se pudieron importar (bloqueo de CDN, tamaño excesivo o tiempo agotado). Puedes subir las que faltan manualmente.`
        : `Some photos couldn't be imported (CDN block, oversize, or timeout). You can upload the missing ones manually.`
      : isEs
      ? 'La fuente bloqueó todas las descargas de imágenes. Sube las fotos manualmente para continuar.'
      : 'The source blocked all image downloads. Upload photos manually to continue.';

  const ctaLabel =
    tone === 'success'
      ? isEs
        ? 'Añadir más fotos manualmente'
        : 'Add more photos manually'
      : isEs
      ? 'Subir las que faltan manualmente'
      : 'Try uploading the missing ones manually';

  const failedResults = results?.filter((r) => !r.ok) ?? [];
  const detailsToggleLabel = showDetails
    ? isEs
      ? 'Ocultar detalles'
      : 'Hide details'
    : isEs
    ? 'Mostrar detalles'
    : 'Show details';

  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className={`flex flex-col gap-3 rounded-card border px-4 py-3 text-sm ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold">{headline}</p>
          <p>{explainer}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={isEs ? 'Cerrar' : 'Dismiss'}
          className={`shrink-0 rounded-md border px-2 py-0.5 text-xs transition ${dismissBorderClass}`}
        >
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {tone !== 'success' && (
          <button
            type="button"
            onClick={handleScrollToUploader}
            className={`inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition ${dismissBorderClass}`}
          >
            {ctaLabel}
          </button>
        )}
        {failedResults.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            className="text-xs underline-offset-2 hover:underline"
            aria-expanded={showDetails}
          >
            {detailsToggleLabel}
          </button>
        )}
      </div>

      {showDetails && failedResults.length > 0 && (
        <ul className="mt-1 space-y-1 border-t border-current/20 pt-2 text-xs">
          {failedResults.map((r, i) => (
            <li key={`${r.url}-${i}`} className="flex flex-col gap-0.5">
              <span className="truncate font-mono opacity-80" title={r.url}>
                {r.url}
              </span>
              <span className="opacity-90">
                <strong>{r.errorCode ?? 'unknown'}</strong>
                {explainErrorCode(r.errorCode, isEs) &&
                  ` — ${explainErrorCode(r.errorCode, isEs)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Maps the API's machine error codes (see /api/properties/:id/import-photos)
// to human-readable strings. Unknown codes get a null fallback so we
// just render the code itself — better than fabricating a translation.
function explainErrorCode(
  code: string | undefined,
  isEs: boolean,
): string | null {
  if (!code) return null;
  if (code.startsWith('fetch_')) {
    return isEs
      ? `respuesta HTTP ${code.replace('fetch_', '')} de la fuente`
      : `HTTP ${code.replace('fetch_', '')} from source`;
  }
  switch (code) {
    case 'timeout':
      return isEs ? 'la descarga tardó demasiado' : 'download timed out';
    case 'too_large':
      return isEs ? 'imagen demasiado grande' : 'image too large';
    case 'not_an_image':
      return isEs ? 'la URL no devolvió una imagen' : 'URL did not return an image';
    case 'unsupported_type':
      return isEs ? 'formato de imagen no soportado' : 'unsupported image format';
    case 'empty':
      return isEs ? 'respuesta vacía' : 'empty response';
    case 'fetch_failed':
      return isEs ? 'no se pudo conectar a la fuente' : 'could not reach source';
    case 'r2_put_failed':
      return isEs ? 'fallo al guardar en almacenamiento' : 'storage write failed';
    case 'forbidden':
      return isEs ? 'permisos insuficientes' : 'permission denied';
    case 'insert_failed':
      return isEs ? 'fallo al registrar la imagen' : 'database insert failed';
    default:
      return null;
  }
}
