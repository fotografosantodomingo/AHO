'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  reviewId: string;
  onClose: () => void;
}

const REASONS = [
  'spam',
  'fake',
  'defamatory',
  'inappropriate',
  'duplicate',
  'other',
] as const;

type Reason = (typeof REASONS)[number];

/**
 * Lightweight report-a-review modal. Open from the reviews list; submits
 * a `review_reports` row via POST /api/reviews/:id/report. Anonymous-
 * callable; signed-in callers get dedup against re-reporting.
 */
export function ReportReviewModal({ reviewId, onClose }: Props) {
  const t = useTranslations('reviews');
  const [reason, setReason] = useState<Reason | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, notes: notes.trim() || null }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      if (data.ok) setSuccess(true);
      else setError(t('reportError'));
    } catch {
      setError(t('reportError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-review-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-lg dark:bg-surface-deep"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="report-review-heading" className="font-brand text-lg font-semibold">
          {t('reportReviewCta')}
        </h2>

        {success ? (
          <div className="mt-4">
            <p className="text-sm">{t('reportSuccess')}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              ✕
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="rep-reason" className="block text-sm font-medium">
                {t('reportReason')}
              </label>
              <select
                id="rep-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as Reason)}
                required
                className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
              >
                <option value="" disabled>
                  —
                </option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(`reportReason_${r}` as `reportReason_${typeof r}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rep-notes" className="block text-sm font-medium">
                {t('reportNotesLabel')}
              </label>
              <textarea
                id="rep-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
              />
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={!reason || submitting}
                className="inline-flex h-9 items-center rounded-lg bg-surface-dark px-4 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
              >
                {t('reportSubmit')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 items-center rounded-lg border border-border-strong px-4 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                ✕
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
