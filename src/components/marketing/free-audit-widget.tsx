'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';

/**
 * Free Audit hero widget — Phase 1 of
 * docs/SUPER_PRO_STAGE_1_PLAN.md.
 *
 * Anonymous visitor pastes a portal listing URL (otodom.pl,
 * idealista.com, zillow.com, ...), hits "Get my campaign". We POST
 * to /api/audit/start which scrapes the source + drafts 9 captions
 * (3 platforms × 3 locales), then redirect to /[locale]/preview/[id].
 *
 * Heavy lifting — Anthropic round-trips, DB insert — happens in the
 * route handler. This widget only owns the input field, the loading
 * state, and the error-banner rendering.
 *
 * Failure paths surfaced to the user (mapped from the route's error
 * codes):
 *   - invalid_url       → "That URL doesn't look right."
 *   - rate_limited      → "Too many audits from this IP. Try again in
 *                          {retryAfter} minutes."
 *   - bot_blocked       → "That portal blocks scrapers. Paste a
 *                          different URL."
 *   - no_facts          → "Couldn't read listing details from that page."
 *   - ai_unavailable    → "Our AI is offline for a moment. Try again."
 *   - everything else   → generic "Something went wrong" hint.
 */
export function FreeAuditWidget() {
  const t = useTranslations('freeAudit');
  const locale = useLocale();
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{
    code: string;
    detail?: string;
  } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError({ code: 'invalid_url' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/audit/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const json = (await res.json()) as
        | { ok: true; auditId: string }
        | { ok: false; error: string; hint?: string; retryAfterSeconds?: number };

      if (!res.ok || !('ok' in json) || !json.ok) {
        const detail =
          'retryAfterSeconds' in json && typeof json.retryAfterSeconds === 'number'
            ? String(Math.ceil(json.retryAfterSeconds / 60))
            : 'hint' in json
              ? json.hint
              : undefined;
        setError({
          code: ('error' in json && json.error) || 'internal_error',
          detail,
        });
        setSubmitting(false);
        return;
      }

      // Hard navigate so the preview page renders fresh with no
      // client-side state to coordinate.
      window.location.assign(`/${locale}/preview/${json.auditId}`);
    } catch (err) {
      setError({
        code: 'internal_error',
        detail: err instanceof Error ? err.message : String(err),
      });
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="free-audit-heading"
      className="relative overflow-hidden border-b border-border bg-surface-warm/40 dark:bg-surface-dark"
    >
      <div className="mx-auto max-w-4xl px-4 py-12 md:px-6 md:py-20">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action dark:text-action-dark">
          {t('eyebrow')}
        </p>
        <h2
          id="free-audit-heading"
          className="mt-3 font-brand text-3xl font-semibold tracking-tight md:text-[44px] md:leading-[1.1]"
        >
          {t('widgetHeading')}
        </h2>
        <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted md:text-lg">
          {t('widgetSub')}
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-3">
          <label htmlFor="audit-url" className="sr-only">
            {t('inputLabel')}
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="audit-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('inputPlaceholder')}
              disabled={submitting}
              autoComplete="url"
              inputMode="url"
              className="h-12 flex-1 rounded-lg border border-border-strong bg-surface px-4 text-base text-ink shadow-whisper placeholder:text-helper focus:border-action focus:outline-none focus:ring-2 focus:ring-action/30 disabled:opacity-50 dark:bg-surface-deep dark:text-ink-inverse"
            />
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary inline-flex h-12 items-center justify-center px-6 text-base font-semibold disabled:opacity-60"
            >
              {submitting ? `${t('submitLoading')}…` : t('submitButton')}
            </button>
          </div>

          {submitting && (
            <p
              role="status"
              className="text-sm text-helper"
            >
              {t('progressHint')}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-800 dark:text-red-200"
            >
              {t.has(`error.${error.code}`)
                ? t(`error.${error.code}` as 'error.internal_error', {
                    minutes: error.detail ?? '?',
                  })
                : t('error.internal_error', { minutes: '?' })}
              {error.detail && error.code !== 'rate_limited' && (
                <span className="ml-1 opacity-80">— {error.detail}</span>
              )}
            </p>
          )}
        </form>

        <p className="mt-6 text-xs text-helper">{t('trustNote')}</p>
      </div>
    </section>
  );
}
