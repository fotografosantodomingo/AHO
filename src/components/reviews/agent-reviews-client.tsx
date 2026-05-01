'use client';

import { useState } from 'react';
import type { AgentDashboardReview } from '@/lib/reviews/queries';
import type { Locale } from '@/i18n/config';

interface Labels {
  empty: string;
  statusPending_verification: string;
  statusPending_moderation: string;
  statusPublished: string;
  statusRejected: string;
  statusHidden: string;
  replyHeading: string;
  replyPlaceholder: string;
  replySubmit: string;
  replyUpdate: string;
  replyClear: string;
  replySaved: string;
}

interface Props {
  reviews: AgentDashboardReview[];
  locale: Locale;
  labels: Labels;
}

const STATUS_TONE: Record<string, string> = {
  pending_verification: 'border-amber-500/40 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-950/20',
  pending_moderation: 'border-amber-500/40 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-950/20',
  published: 'border-emerald-500/40 bg-emerald-50/50 dark:border-emerald-400/40 dark:bg-emerald-950/20',
  rejected: 'border-danger/40 bg-danger/5',
  hidden: 'border-border bg-surface-muted dark:bg-surface-dark',
};

function statusLabel(status: string, labels: Labels): string {
  switch (status) {
    case 'pending_verification':
      return labels.statusPending_verification;
    case 'pending_moderation':
      return labels.statusPending_moderation;
    case 'published':
      return labels.statusPublished;
    case 'rejected':
      return labels.statusRejected;
    case 'hidden':
      return labels.statusHidden;
    default:
      return status;
  }
}

export function AgentReviewsClient({ reviews, locale, labels }: Props) {
  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  if (reviews.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-helper">
        {labels.empty}
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <ReviewCard
          key={r.id}
          review={r}
          dateFormatter={dateFormatter}
          labels={labels}
        />
      ))}
    </ul>
  );
}

function ReviewCard({
  review,
  dateFormatter,
  labels,
}: {
  review: AgentDashboardReview;
  dateFormatter: Intl.DateTimeFormat;
  labels: Labels;
}) {
  const [reply, setReply] = useState(review.agentReply ?? '');
  const [savedReply, setSavedReply] = useState(review.agentReply ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  async function save(nextValue: string | null) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/reviews/${review.id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: nextValue }),
      });
      if (res.ok) {
        setSavedReply(nextValue ?? '');
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 2000);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const tone = STATUS_TONE[review.status] ?? 'border-border bg-surface dark:bg-surface-deep';
  const canReply = review.status === 'published';
  const dirty = reply.trim() !== savedReply.trim();
  const replyLen = reply.trim().length;
  const canSave = canReply && dirty && replyLen >= 10 && replyLen <= 2000;

  return (
    <li
      className={`rounded-card border p-4 shadow-whisper ${tone}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          <span className="text-amber-500" aria-hidden="true">
            {'★'.repeat(review.rating)}
            {'☆'.repeat(5 - review.rating)}
          </span>{' '}
          <span className="text-helper">{review.reviewerName}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-helper">{statusLabel(review.status, labels)}</span>
          <time className="font-mono text-xs text-helper" dateTime={review.createdAt}>
            {dateFormatter.format(new Date(review.createdAt))}
          </time>
        </div>
      </header>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
        {review.body}
      </p>

      {canReply && (
        <div className="mt-4 border-t border-border/50 pt-3">
          <label
            htmlFor={`reply-${review.id}`}
            className="block text-xs font-semibold uppercase tracking-wide text-helper"
          >
            {labels.replyHeading}
          </label>
          <textarea
            id={`reply-${review.id}`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder={labels.replyPlaceholder}
            className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => save(reply.trim())}
              disabled={!canSave || submitting}
              className="btn-primary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savedReply ? labels.replyUpdate : labels.replySubmit}
            </button>
            {savedReply && (
              <button
                type="button"
                onClick={() => {
                  setReply('');
                  save(null);
                }}
                disabled={submitting}
                className="inline-flex h-8 items-center rounded-lg px-3 text-xs text-helper transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60 dark:hover:text-ink-inverse"
              >
                {labels.replyClear}
              </button>
            )}
            {savedFlash && (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">
                ✓ {labels.replySaved}
              </span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
