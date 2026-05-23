'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const STATUSES = ['applied', 'contacted', 'onboarding', 'converted', 'declined'] as const;
type Status = (typeof STATUSES)[number];

/**
 * Inline status + notes editor for a single Founding 50 application
 * row in /admin/founding-agents. Posts to
 * /api/admin/founding-agents/[id]/status which (a) re-checks
 * is_admin() server-side, (b) writes the patch, (c) sets
 * contacted_at / converted_at on the right status transitions.
 *
 * Why a server action wouldn't be simpler: the admin page is
 * force-dynamic + we want optimistic UI without a full page refresh
 * on every status change. Client-side fetch + router.refresh() gives
 * us the snappier flow.
 */
export function FoundingAgentStatusForm({
  id,
  status: initialStatus,
  notes: initialNotes,
}: {
  id: string;
  status: Status;
  notes: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = status !== initialStatus || notes !== initialNotes;

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/founding-agents/${id}/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setSavedAt(Date.now());
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSave} className="w-full space-y-2 sm:w-64">
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        Status
      </label>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as Status)}
        disabled={saving}
        className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        Notes
      </label>
      <textarea
        rows={3}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={saving}
        maxLength={4000}
        placeholder="Internal — never shown to applicant."
        className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
      />

      <button
        type="submit"
        disabled={!dirty || saving}
        className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : dirty ? 'Save' : savedAt ? '✓ Saved' : 'Saved'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
