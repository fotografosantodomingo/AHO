'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from 'next-intl';

/**
 * Persistent dead-letter UI for the photo-import flow. Renders a card
 * on the listing edit page listing every URL that failed even after
 * the in-call retry exhausted, so the agent can take action later
 * (instead of the original silent-loss behavior).
 *
 * Difference from `<PhotoImportBanner>`:
 *   - Banner is one-shot, sessionStorage-backed, dies on tab close.
 *     Useful for "what just happened on the import I ran a second ago".
 *   - This component reads from the database every page load. Useful
 *     for "I came back two days later — what's still broken?"
 *
 * Per failure the agent can:
 *   - Retry: POST the single URL back to the parent import-photos
 *     endpoint. On success, the SQL `record_photo_import_failure`
 *     conflict path bumps attempts; the success-path RPC clears
 *     resolved_at. We optimistically remove the row from local state.
 *   - Dismiss: hit the failures POST with action=dismiss. Marks the
 *     row resolved without retrying. Used when the agent has already
 *     re-uploaded the photo manually or decided it's not worth saving.
 */

interface FailureRow {
  id: string;
  source_url: string;
  error_code: string;
  attempts: number;
  first_failed_at: string;
  last_failed_at: string;
}

interface Props {
  propertyId: string;
}

export function PhotoImportFailures({ propertyId }: Props) {
  const locale = useLocale();
  const isEs = locale === 'es';

  const [failures, setFailures] = useState<FailureRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/import-photos/failures`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        // 401 means session expired — silently render nothing rather than
        // flashing an error banner on a page the agent might have left open.
        setFailures([]);
        return;
      }
      const json = (await res.json()) as { failures?: FailureRow[] };
      setFailures(json.failures ?? []);
    } catch {
      setFailures([]);
    }
  }, [propertyId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!failures || failures.length === 0) return null;

  async function handleRetry(row: FailureRow) {
    setBusyId(row.id);
    setGlobalError(null);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/import-photos`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ urls: [row.source_url] }),
        },
      );
      if (!res.ok) {
        setGlobalError(
          isEs ? 'No se pudo reintentar. Inténtalo de nuevo.' : 'Retry failed. Try again.',
        );
        return;
      }
      const json = (await res.json()) as {
        imported?: number;
        failed?: number;
        results?: Array<{ ok: boolean; errorCode?: string }>;
      };
      const succeeded = (json.imported ?? 0) > 0;
      if (succeeded) {
        // Optimistic: success path on the server already cleared
        // resolved_at; pull it from the local list.
        setFailures((prev) => (prev ?? []).filter((f) => f.id !== row.id));
      } else {
        // Server bumped attempts on the existing row; refresh from
        // server so the new attempt count + error code shows up.
        await load();
        const newCode = json.results?.[0]?.errorCode;
        setGlobalError(
          newCode
            ? isEs
              ? `Sigue fallando (${newCode}). Sube la foto manualmente.`
              : `Still failing (${newCode}). Upload the photo manually.`
            : isEs
            ? 'Sigue fallando. Sube la foto manualmente.'
            : 'Still failing. Upload the photo manually.',
        );
      }
    } catch {
      setGlobalError(
        isEs ? 'Error de red. Inténtalo de nuevo.' : 'Network error. Try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(row: FailureRow) {
    setBusyId(row.id);
    setGlobalError(null);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/import-photos/failures`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'dismiss', source_url: row.source_url }),
        },
      );
      if (!res.ok) {
        setGlobalError(
          isEs ? 'No se pudo descartar. Inténtalo de nuevo.' : 'Dismiss failed. Try again.',
        );
        return;
      }
      setFailures((prev) => (prev ?? []).filter((f) => f.id !== row.id));
    } catch {
      setGlobalError(
        isEs ? 'Error de red. Inténtalo de nuevo.' : 'Network error. Try again.',
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      role="alert"
      // Reuse the warn-tone palette from <PhotoImportBanner> so the two
      // banners look like part of the same family on the edit page.
      className="flex flex-col gap-3 rounded-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
    >
      <div className="space-y-1">
        <p className="font-semibold">
          {isEs
            ? `${failures.length} URL${failures.length === 1 ? '' : 's'} no se importaron`
            : `${failures.length} URL${failures.length === 1 ? '' : 's'} failed to import`}
        </p>
        <p>
          {isEs
            ? 'Los reintentos automáticos no funcionaron. Reintentar ahora o descartar para subir manualmente.'
            : "Automatic retries didn't recover. Retry now, or dismiss and upload manually."}
        </p>
      </div>

      {globalError && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs">
          {globalError}
        </p>
      )}

      <ul className="space-y-2 border-t border-current/20 pt-2 text-xs">
        {failures.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <span
                className="block truncate font-mono opacity-80"
                title={row.source_url}
              >
                {row.source_url}
              </span>
              <span className="opacity-90">
                <strong>{row.error_code}</strong>
                {row.attempts > 1 && (
                  <span className="ml-1 opacity-70">
                    {isEs
                      ? `· ${row.attempts} intentos`
                      : `· ${row.attempts} attempts`}
                  </span>
                )}
              </span>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => handleRetry(row)}
                disabled={busyId === row.id}
                className="inline-flex h-7 items-center rounded-md border border-amber-500/40 px-2 text-xs font-medium transition hover:bg-amber-500/10 disabled:opacity-50"
              >
                {busyId === row.id
                  ? isEs
                    ? 'Reintentando…'
                    : 'Retrying…'
                  : isEs
                  ? 'Reintentar'
                  : 'Retry'}
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(row)}
                disabled={busyId === row.id}
                className="inline-flex h-7 items-center rounded-md border border-amber-500/40 px-2 text-xs font-medium transition hover:bg-amber-500/10 disabled:opacity-50"
              >
                {isEs ? 'Descartar' : 'Dismiss'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
