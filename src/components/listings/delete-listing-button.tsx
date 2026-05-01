'use client';

import { useState } from 'react';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  /** Title used in the confirm prompt so users don't accidentally delete
   *  the wrong listing. */
  label: string;
}

/**
 * Delete-listing button. Hits DELETE /api/listings/{id}. Confirms via
 * native window.confirm to keep the dependency footprint tiny — a real
 * modal would need a portal + focus trap; the listings table isn't
 * worth that bundle weight today.
 *
 * On success: refreshes the table (RSC re-fetch). On failure: surfaces
 * an inline error code.
 */
export function DeleteListingButton({ id, label }: Props) {
  const router = useRouter();
  const locale = useLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const confirmText =
      locale === 'es'
        ? `¿Eliminar "${label}" definitivamente? Esta acción no se puede deshacer.`
        : `Permanently delete "${label}"? This cannot be undone.`;
    if (!window.confirm(confirmText)) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/listings/${id}`, { method: 'DELETE' });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (!res.ok || !body.ok) {
        setError(body.errorCode ?? `http_${res.status}`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network_error');
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="inline-flex h-7 items-center rounded-md border border-red-300/60 bg-red-50/40 px-2 text-xs text-red-800 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800/60 dark:bg-red-950/20 dark:text-red-200 dark:hover:bg-red-950/40"
      >
        {pending ? '…' : locale === 'es' ? 'Eliminar' : 'Delete'}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
