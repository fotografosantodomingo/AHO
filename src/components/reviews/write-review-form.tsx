'use client';

import { useState, type FormEvent } from 'react';

interface Labels {
  ratingLabel: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  bodyMinHelp: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailHelp: string;
  submit: string;
  submitting: string;
  success: string;
  error: string;
  selfReviewError: string;
}

interface Props {
  agentId: string;
  locale: 'en' | 'es';
  labels: Labels;
}

const MIN_BODY = 50;
const MAX_BODY = 5000;

/**
 * Anonymous-friendly review submission form. Submits to /api/reviews;
 * shows a success message instructing the reviewer to confirm via email.
 *
 * Star picker: 1–5 buttons; body textarea with live char count vs. the
 * 50-char minimum + 5000-char cap. Submit disabled until rating is set
 * AND body meets minimum length.
 */
export function WriteReviewForm({ agentId, locale, labels }: Props) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyLen = body.trim().length;
  const canSubmit =
    rating >= 1 && rating <= 5 && bodyLen >= MIN_BODY && name.trim().length >= 1 && email.trim().length >= 5;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          rating,
          body: body.trim(),
          reviewer_name: name.trim(),
          reviewer_email: email.trim(),
          locale,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (data.ok) {
        setSuccess(true);
      } else if (data.errorCode === 'self_review_forbidden') {
        setError(labels.selfReviewError);
      } else {
        setError(labels.error);
      }
    } catch {
      setError(labels.error);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="mt-4 rounded-card border border-border bg-surface p-4 text-sm shadow-whisper dark:bg-surface-deep">
        <p>{labels.success}</p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      {/* Star picker */}
      <div>
        <label className="block text-sm font-medium">{labels.ratingLabel}</label>
        <div className="mt-1 flex gap-1" role="radiogroup" aria-label={labels.ratingLabel}>
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (hover || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                className={`text-2xl transition ${
                  filled ? 'text-amber-500' : 'text-border-strong/40 hover:text-amber-300'
                }`}
              >
                {filled ? '★' : '☆'}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="rv-body" className="block text-sm font-medium">
          {labels.bodyLabel}
        </label>
        <textarea
          id="rv-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          maxLength={MAX_BODY}
          placeholder={labels.bodyPlaceholder}
          className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
        />
        <p className="mt-1 text-xs text-helper">
          {labels.bodyMinHelp} ({bodyLen}/{MAX_BODY})
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rv-name" className="block text-sm font-medium">
            {labels.nameLabel}
          </label>
          <input
            id="rv-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder={labels.namePlaceholder}
            className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
          />
        </div>
        <div>
          <label htmlFor="rv-email" className="block text-sm font-medium">
            {labels.emailLabel}
          </label>
          <input
            id="rv-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            className="mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
          />
          <p className="mt-1 text-xs text-helper">{labels.emailHelp}</p>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit || submitting}
        className="inline-flex h-10 items-center justify-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
      >
        {submitting ? labels.submitting : labels.submit}
      </button>
    </form>
  );
}
