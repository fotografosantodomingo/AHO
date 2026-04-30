'use client';

import { useTransition, useState } from 'react';
import { archiveListing, unarchiveListing } from '@/lib/admin/actions';

interface ArchiveButtonProps {
  propertyId: string;
  status: string;
}

/**
 * Tiny client-side archive/unarchive button for the admin listings table.
 * Uses a `useTransition` so the row gets a pending visual state while the
 * server action runs, and `router.refresh()` happens automatically via
 * the action's `revalidatePath` call.
 *
 * Confirm dialog before archiving — irreversible-ish (the unarchive
 * action exists, but a stray click on a customer's active listing would
 * still be visible-to-public for the few seconds it takes to undo).
 */
export function ArchiveButton({ propertyId, status }: ArchiveButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === 'archived') {
    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setError(null);
            const r = await unarchiveListing(propertyId);
            if (!r.ok) setError(r.error ?? 'failed');
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
          const r = await archiveListing(propertyId);
          if (!r.ok) setError(r.error ?? 'failed');
        });
      }}
      className="inline-flex h-7 items-center rounded-lg border border-warn/40 bg-warn-bg/40 px-2 text-xs text-warn transition hover:bg-warn-bg disabled:opacity-50"
      title={error ?? 'Archive (hide from public)'}
    >
      {isPending ? '…' : 'Archive'}
    </button>
  );
}
