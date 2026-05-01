'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/config';

interface Props {
  /** The user's own email — passed from the server component for the
   *  confirmation comparison. The server route also re-checks it. */
  email: string;
  locale: Locale;
}

/**
 * Self-service GDPR account deletion. Sits at the bottom of
 * /dashboard/profile under a "Danger zone" heading. Two-step:
 *
 *   1. Click "Delete account" → confirmation panel slides open.
 *   2. Type the user's email exactly → "Permanently delete" enables.
 *      Click → POST /api/account/delete → on 200 redirect to /{locale}.
 *
 * The button is intentionally not a modal/dialog — inline disclosure is
 * less likely to be misclicked than a full-screen blocker, and it
 * matches the rest of the dashboard's flat content patterns. The email
 * confirmation is the actual safety net (typo-protection without a
 * re-auth roundtrip).
 */
export function DangerZone({ email, locale }: Props) {
  const t = useTranslations('dangerZone');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  async function handleDelete() {
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm_email: typed.trim() }),
      });
      if (!res.ok) {
        let code = 'errorGeneric';
        try {
          const j = (await res.json()) as { errorCode?: string };
          if (j.errorCode === 'confirmation_mismatch') code = 'errorMismatch';
          else if (j.errorCode === 'stripe_cancel_failed') code = 'errorStripe';
        } catch {
          /* fallthrough */
        }
        setError(t(code as 'errorGeneric'));
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      // Brief pause so the user sees the success state, then bounce.
      setTimeout(() => {
        router.replace(`/${locale}`);
        router.refresh();
      }, 800);
    } catch {
      setError(t('errorGeneric'));
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="mt-12 rounded-card border border-error/40 bg-error/5 p-6"
    >
      <h2
        id="danger-zone-heading"
        className="font-brand text-base font-semibold tracking-tight text-error"
      >
        {t('heading')}
      </h2>
      <p className="mt-1 text-sm text-helper">{t('subheading')}</p>

      <div className="mt-5 rounded-lg border border-border bg-surface p-4 dark:bg-surface-deep">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t('deleteAccountTitle')}</h3>
            <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
              {t('deleteAccountBody')}
            </p>
          </div>
          {!open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-9 shrink-0 items-center justify-center self-start rounded-lg border border-error/40 px-4 text-sm font-medium text-error transition hover:bg-error/10"
            >
              {t('deleteAccountButton')}
            </button>
          )}
        </div>

        {open && (
          <div className="mt-5 space-y-4 border-t border-border pt-5 text-sm">
            <h4 className="font-semibold">{t('confirmModalTitle')}</h4>
            <p>{t('confirmModalBody')}</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                  {t('whatGetsDeletedHeading')}
                </p>
                <p className="mt-1 text-ink-muted dark:text-ink-inverse-muted">
                  {t('whatGetsDeletedItems')}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                  {t('whatStaysHeading')}
                </p>
                <p className="mt-1 text-ink-muted dark:text-ink-inverse-muted">
                  {t('whatStaysItems')}
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="confirm-email"
                className="mb-1 block text-xs font-medium text-ink dark:text-ink-inverse"
              >
                {t('confirmEmailLabel')}
              </label>
              <input
                id="confirm-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t('confirmEmailPlaceholder')}
                className="block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-helper focus:border-action focus:outline-none dark:bg-surface-deep"
                disabled={submitting || success}
              />
            </div>

            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="text-sm text-action">
                {t('successRedirecting')}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setTyped('');
                  setError(null);
                }}
                disabled={submitting || success}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-border-strong px-4 text-sm font-medium transition hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/5"
              >
                {t('cancelButton')}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!matches || submitting || success}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-error px-4 text-sm font-medium text-white transition hover:bg-error/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? t('deletingState') : t('confirmButton')}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
