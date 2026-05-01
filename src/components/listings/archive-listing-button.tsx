'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

interface Props {
  id: string;
  /** Current status — controls whether we show "Archive" or "Restore". */
  isArchived: boolean;
}

/**
 * Agent-side archive / restore. Different from delete-listing-button:
 * archive is reversible (status flips back to draft on undo) and keeps
 * the row + history intact. Delete is hard.
 *
 * Always available to agents on their own org's listings (RLS gates).
 * Admins also have it via /admin.
 */
export function ArchiveListingButton({ id, isArchived }: Props) {
  const t = useTranslations('archiveListing');
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!isArchived) {
      const ok = window.confirm(
        locale === 'es'
          ? 'Archivar este anuncio. Quedará oculto al público pero se conserva en tu historial. ¿Continuar?'
          : 'Archive this listing. It will be hidden from the public but kept in your history. Continue?',
      );
      if (!ok) return;
    }
    setError(null);
    setPending(true);
    try {
      const url = isArchived ? `/api/listings/${id}/archive?undo=1` : `/api/listings/${id}/archive`;
      const res = await fetch(url, { method: 'POST' });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.errorCode ?? `http_${res.status}`);
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
        className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
      >
        {pending ? '…' : isArchived ? t('restore') : t('archive')}
      </button>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
