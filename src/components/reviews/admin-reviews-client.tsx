'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModerationQueueReview } from '@/lib/reviews/queries';
import type { Locale } from '@/i18n/config';

interface Labels {
  empty: string;
  approve: string;
  reject: string;
  hide: string;
  unhide: string;
  reports: (count: number) => string;
}

interface Props {
  reviews: ModerationQueueReview[];
  locale: Locale;
  labels: Labels;
}

export function AdminReviewsClient({ reviews, locale, labels }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

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

  async function moderate(reviewId: string, action: 'approve' | 'reject' | 'hide' | 'unhide') {
    setPending(reviewId + ':' + action);
    try {
      const res = await fetch(`/api/admin/reviews/${reviewId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) router.refresh();
      else alert(`Moderation failed (${res.status})`);
    } finally {
      setPending(null);
    }
  }

  return (
    <ul className="space-y-4">
      {reviews.map((r) => {
        const isPending = pending?.startsWith(r.id);
        return (
          <li
            key={r.id}
            className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  <span className="text-amber-500" aria-hidden="true">
                    {'★'.repeat(r.rating)}
                    {'☆'.repeat(5 - r.rating)}
                  </span>{' '}
                  <span className="text-helper">{r.reviewerName}</span>
                  {r.reviewerEmail && (
                    <span className="ml-2 font-mono text-xs text-helper">
                      &lt;{r.reviewerEmail}&gt;
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-helper">
                  {r.agentName ? `→ ${r.agentName}` : `agent ${r.agentId.slice(0, 8)}`} ·{' '}
                  {r.status} · {r.locale}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.reportCount > 0 && (
                  <span className="rounded-md bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">
                    {labels.reports(r.reportCount)}
                  </span>
                )}
                <time className="font-mono text-xs text-helper" dateTime={r.createdAt}>
                  {dateFormatter.format(new Date(r.createdAt))}
                </time>
              </div>
            </header>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
              {r.body}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {r.status === 'pending_moderation' && (
                <>
                  <button
                    type="button"
                    onClick={() => moderate(r.id, 'approve')}
                    disabled={isPending}
                    className="inline-flex h-8 items-center rounded-lg bg-emerald-700 px-3 text-xs font-medium text-white shadow-whisper transition hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {labels.approve}
                  </button>
                  <button
                    type="button"
                    onClick={() => moderate(r.id, 'reject')}
                    disabled={isPending}
                    className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-xs font-medium transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
                  >
                    {labels.reject}
                  </button>
                </>
              )}
              {r.status === 'published' && (
                <button
                  type="button"
                  onClick={() => moderate(r.id, 'hide')}
                  disabled={isPending}
                  className="inline-flex h-8 items-center rounded-lg border border-border-strong px-3 text-xs font-medium transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
                >
                  {labels.hide}
                </button>
              )}
              {r.status === 'hidden' && (
                <button
                  type="button"
                  onClick={() => moderate(r.id, 'unhide')}
                  disabled={isPending}
                  className="btn-primary h-8 px-3 text-xs disabled:opacity-60"
                >
                  {labels.unhide}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
