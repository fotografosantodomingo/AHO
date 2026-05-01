'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface ArchiveButtonProps {
  propertyId: string;
  status: string;
}

/**
 * Admin-only archive/unarchive button on the admin listings table.
 *
 * Calls the existing `POST /api/listings/:id/archive[?undo=1]` API
 * route. RLS gates the UPDATE — admin RLS allows it; a non-admin
 * caller would 403. This route also writes the audit_log entry
 * (kind = 'listing.archived' / 'listing.unarchived') with the
 * scrubbed payload from 0015.
 *
 * Replaces the prior `archiveListing` / `unarchiveListing` server-
 * action path. Server Actions are unreliable on @cloudflare/next-on-
 * pages (per DECISIONS 2026-04-30); the listing form already moved
 * off them. This is the same migration applied to the admin button.
 */
export function ArchiveButton({ propertyId, status }: ArchiveButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function call(undo: boolean) {
    const url = `/api/listings/${propertyId}/archive${undo ? '?undo=1' : ''}`;
    const res = await fetch(url, { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      errorCode?: string;
    };
    if (!res.ok || !body.ok) {
      throw new Error(body.errorCode ?? `http_${res.status}`);
    }
  }

  if (status === 'archived') {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            try {
              await call(true);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'failed');
            }
          });
        }}
        className="inline-flex h-7 items-center rounded-lg border border-border-strong px-2 text-xs transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
        title={error ?? 'Restore to draft'}
      >
        {isPending ? '…' : 'Unarchive'}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (
          !confirm(
            'Archive this listing? It will be hidden from the public site immediately. The owner can republish it from the dashboard.',
          )
        ) {
          return;
        }
        startTransition(async () => {
          setError(null);
          try {
            await call(false);
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'failed');
          }
        });
      }}
      className="inline-flex h-7 items-center rounded-lg border border-warn/40 bg-warn-bg/40 px-2 text-xs text-warn transition hover:bg-warn-bg disabled:opacity-50"
      title={error ?? 'Archive (hide from public)'}
    >
      {isPending ? '…' : 'Archive'}
    </button>
  );
}
