'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  messageId: string;
  initialBody: string;
}

/**
 * Inline approve / edit-and-send / reject control row for one pending
 * AI assistant draft in the dashboard inbox.
 *
 * Edit mode is opened lazily so the textarea only mounts when the
 * agent clicks "Edit & Send" — keeps the inbox list lightweight.
 */
export function PendingActions({ messageId, initialBody }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'edit' | 'reject' | null>(null);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);

  async function approve(editedBody?: string) {
    setBusy(editedBody ? 'edit' : 'approve');
    setError(null);
    try {
      const res = await fetch('/api/dashboard/ai-inbox/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId, ...(editedBody ? { editedBody } : {}) }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(typeof detail.error === 'string' ? detail.error : 'request_failed');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy('reject');
    setError(null);
    try {
      const res = await fetch('/api/dashboard/ai-inbox/reject', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messageId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        setError(typeof detail.error === 'string' ? detail.error : 'request_failed');
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <div className="mt-3 space-y-2">
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={6}
          className="block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => approve(edited)}
            disabled={busy !== null || !edited.trim()}
            className="inline-flex h-9 items-center rounded-lg bg-action px-4 text-sm font-semibold text-white shadow-whisper transition hover:opacity-95 disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
          >
            Send edit
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setEdited(initialBody);
            }}
            disabled={busy !== null}
            className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            Cancel
          </button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => approve()}
        disabled={busy !== null}
        className="inline-flex h-9 items-center rounded-lg bg-action px-4 text-sm font-semibold text-white shadow-whisper transition hover:opacity-95 disabled:opacity-50 dark:bg-action-dark dark:text-surface-deep"
      >
        {busy === 'approve' ? 'Sending…' : 'Send'}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={busy !== null}
        className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        Edit & Send
      </button>
      <button
        type="button"
        onClick={() => reject()}
        disabled={busy !== null}
        className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm text-helper transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        {busy === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
      {error && (
        <p role="alert" className="basis-full text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
