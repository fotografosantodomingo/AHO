'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { WriteReviewForm } from './write-review-form';
import { ReportReviewModal } from './report-review-modal';
import type { PublicReview } from '@/lib/reviews/queries';

interface Props {
  agentId: string;
  reviews: PublicReview[];
  aggregateCount: number;
  aggregateAvg: number;
}

/**
 * Public reviews section for /agents/[slug].
 *   - Header: avg rating + count (or "no reviews yet")
 *   - List of reviews with stars + body + agent reply (if any) + report button
 *   - "Write a review" CTA expands the inline submission form
 *
 * Empty state honors the real-only data rule: nothing fabricated, just
 * an honest "no reviews yet" + the CTA. Per the AggregateRating omission
 * rule (DECISIONS), the JSON-LD is rendered server-side and only when
 * count > 0; this component is purely the visual surface.
 */
export function ReviewsSection({
  agentId,
  reviews,
  aggregateCount,
  aggregateAvg,
}: Props) {
  const t = useTranslations('reviews');
  const locale = useLocale() as 'en' | 'es';
  const [writing, setWriting] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);

  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <section
      aria-labelledby="reviews-heading"
      className="mt-12 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2
          id="reviews-heading"
          className="font-brand text-xl font-semibold tracking-tight"
        >
          {t('sectionHeading')}
        </h2>
        {aggregateCount > 0 && (
          <p className="text-sm text-helper">
            <span className="text-amber-500" aria-hidden="true">
              {'★'.repeat(Math.round(aggregateAvg))}
              {'☆'.repeat(5 - Math.round(aggregateAvg))}
            </span>{' '}
            {t(aggregateCount === 1 ? 'ratingAggregate_one' : 'ratingAggregate', {
              avg: aggregateAvg.toFixed(1),
              count: aggregateCount,
            })}
          </p>
        )}
      </header>

      {reviews.length === 0 ? (
        <p className="mt-4 text-sm text-helper">{t('noReviews')}</p>
      ) : (
        <ul className="mt-6 space-y-6">
          {reviews.map((r) => (
            <li
              key={r.id}
              className="border-b border-border/50 pb-6 last:border-b-0 last:pb-0"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  <span className="text-amber-500" aria-hidden="true">
                    {'★'.repeat(r.rating)}
                    {'☆'.repeat(5 - r.rating)}
                  </span>{' '}
                  <span className="ml-1 text-helper">{r.reviewerName}</span>
                </p>
                <time className="font-mono text-xs text-helper" dateTime={r.createdAt}>
                  {dateFormatter.format(new Date(r.createdAt))}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                {r.body}
              </p>
              {r.agentReply && (
                <div className="mt-3 rounded-card border border-border/60 bg-surface-muted p-3 dark:bg-surface-dark">
                  <p className="text-xs font-semibold uppercase tracking-wide text-helper">
                    {t('agentReplyHeading')}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
                    {r.agentReply}
                  </p>
                </div>
              )}
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setReporting(r.id)}
                  className="text-xs text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
                >
                  {t('reportReviewCta')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 border-t border-border pt-6">
        {writing ? (
          <>
            <p className="text-sm text-helper">{t('writeReviewSubheading')}</p>
            <WriteReviewForm
              agentId={agentId}
              locale={locale}
              labels={{
                ratingLabel: t('ratingLabel'),
                bodyLabel: t('bodyLabel'),
                bodyPlaceholder: t('bodyPlaceholder'),
                bodyMinHelp: t('bodyMinHelp'),
                nameLabel: t('nameLabel'),
                namePlaceholder: t('namePlaceholder'),
                emailLabel: t('emailLabel'),
                emailHelp: t('emailHelp'),
                submit: t('submitButton'),
                submitting: t('submittingButton'),
                success: t('submitSuccess'),
                error: t('submitError'),
                selfReviewError: t('selfReviewError'),
              }}
            />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setWriting(true)}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
          >
            {t('writeReviewCta')}
          </button>
        )}
      </div>

      {reporting && (
        <ReportReviewModal
          reviewId={reporting}
          onClose={() => setReporting(null)}
        />
      )}
    </section>
  );
}
