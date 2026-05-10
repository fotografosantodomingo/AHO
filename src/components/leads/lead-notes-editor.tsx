'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  leadId: string;
  initialNotes: string;
  /** Pre-translated UI strings — keeps this island free of next-intl. */
  labels: {
    placeholder: string;
    saving: string;
    saved: string;
    error: string;
    srLabel: string;
  };
}

/**
 * Agent-private notes textarea for the per-lead detail page. Auto-saves
 * on blur via PUT /api/leads/:id/notes. Optimistic UX:
 *
 *   - Initial state shows the value and no status indicator.
 *   - On blur, if the value differs from the last saved snapshot, fires
 *     the PUT and shows "Saving…" → "Saved" / "Couldn't save" inline.
 *   - On success, rolls the saved snapshot forward and triggers a
 *     `router.refresh()` so the timeline picks up the new `updated_at`.
 *
 * Single-island scope by design — the rest of the page is server-rendered.
 */
export function LeadNotesEditor({ leadId, initialNotes, labels }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(initialNotes);
  const lastSavedRef = useRef(initialNotes);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [isPending, startTransition] = useTransition();

  function save() {
    if (value === lastSavedRef.current) return; // no-op
    setStatus('saving');
    startTransition(async () => {
      try {
        const res = await fetch(`/api/leads/${leadId}/notes`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: value }),
        });
        if (!res.ok) {
          setStatus('error');
          return;
        }
        lastSavedRef.current = value;
        setStatus('saved');
        router.refresh();
      } catch {
        setStatus('error');
      }
    });
  }

  return (
    <div className="space-y-2">
      <label htmlFor={`lead-notes-${leadId}`} className="sr-only">
        {labels.srLabel}
      </label>
      <textarea
        id={`lead-notes-${leadId}`}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (status === 'saved' || status === 'error') setStatus('idle');
        }}
        onBlur={save}
        placeholder={labels.placeholder}
        rows={5}
        disabled={isPending}
        className="block w-full resize-y rounded-card border border-border-strong/60 bg-surface px-3 py-2 text-sm shadow-whisper focus:border-action focus:outline-none focus:ring-2 focus:ring-action/30 disabled:opacity-60 dark:bg-surface-deep"
      />
      <div className="min-h-[1.25rem] text-xs text-helper" aria-live="polite">
        {status === 'saving' && <span>{labels.saving}</span>}
        {status === 'saved' && <span>{labels.saved}</span>}
        {status === 'error' && (
          <span role="alert" className="text-red-600">
            {labels.error}
          </span>
        )}
      </div>
    </div>
  );
}
