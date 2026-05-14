'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

/**
 * "Share to my socials" — the one-click publish UI on the listing edit
 * page. Phase F of docs/SOCIAL_AUTOMATION_PLAN.md.
 *
 * Three states:
 *   - Empty:   user has no connected social accounts → upsell to Connect
 *   - Idle:    user has accounts → "Share now" CTA + pre-flight account list
 *   - Result:  per-attempt outcomes (succeeded / failed / skipped)
 *              with platform name, account display name, external link,
 *              error reason, and a Retry-failed button that re-runs only
 *              the failed-and-retryable subset.
 *
 * Calls POST /api/social/post (Phase E). Sync fan-out — the request
 * blocks until every target settles (typically 1-3s for FB+IG; LinkedIn
 * currently always returns `skipped/oauth_not_implemented`).
 *
 * Visible only to Pro Automation tier (the parent page checks; this
 * component trusts the gate). For drafts (status != 'active') the
 * parent passes `isPublished={false}` and the component renders the
 * "publish-first" notice instead of the action.
 */

export type SharePlatform = 'facebook' | 'instagram' | 'linkedin';

export interface ConnectedAccount {
  platform: SharePlatform;
  externalAccountId: string;
  displayName: string | null;
}

interface AttemptOutcome {
  platform: SharePlatform;
  externalAccountId: string;
  displayName: string | null;
  status: 'succeeded' | 'failed' | 'skipped';
  externalPostId?: string;
  externalPostUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  isRetryable: boolean;
}

interface Props {
  propertyId: string;
  locale: Locale;
  connectedAccounts: ConnectedAccount[];
  isPublished: boolean;
}

const PLATFORM_EMOJI: Record<SharePlatform, string> = {
  facebook: '📘',
  instagram: '📷',
  linkedin: '💼',
};

export function ShareToSocials({
  propertyId,
  locale,
  connectedAccounts,
  isPublished,
}: Props) {
  const t = useTranslations('social.share');
  const [posting, setPosting] = useState(false);
  const [attempts, setAttempts] = useState<AttemptOutcome[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  async function submit(platformsToInclude?: SharePlatform[]) {
    setPosting(true);
    setServerError(null);
    try {
      const res = await fetch('/api/social/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          locale,
          ...(platformsToInclude ? { platforms: platformsToInclude } : {}),
        }),
      });
      const json = (await res.json()) as
        | { ok: true; socialPostId: string; attempts: AttemptOutcome[] }
        | { ok: false; errorCode: string; details?: string };
      if (!res.ok || !('attempts' in json)) {
        const code =
          'errorCode' in json ? json.errorCode : `http_${res.status}`;
        setServerError(t('serverErrorCode', { code }));
        return;
      }
      // Merge into prior attempts on retry (so the UI keeps showing
      // succeeded rows from the first pass).
      setAttempts((prev) => {
        if (!prev) return json.attempts;
        const byKey = new Map(prev.map((a) => [a.externalAccountId, a]));
        for (const a of json.attempts) byKey.set(a.externalAccountId, a);
        return Array.from(byKey.values());
      });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('unexpectedError'));
    } finally {
      setPosting(false);
    }
  }

  const failedRetryable = (attempts ?? []).filter(
    (a) => a.status === 'failed' && a.isRetryable,
  );

  // -------- Empty state: no connected accounts --------
  if (connectedAccounts.length === 0) {
    return (
      <section className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          Pro Automation
        </p>
        <h2 className="mt-1 font-brand text-lg font-semibold tracking-tight">
          {t('emptyHeading')}
        </h2>
        <p className="mt-1 text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('emptyBody')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href={`/api/oauth/meta/start?returnTo=${encodeURIComponent(
              localePath(locale, '/dashboard/properties/[id]').replace(
                '/[id]',
                `/${propertyId}`,
              ),
            )}`}
            className="btn-primary inline-flex h-10 items-center px-5"
          >
            {t('connectFirst')}
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            Pro Automation
          </p>
          <h2 className="mt-1 font-brand text-lg font-semibold tracking-tight">
            {t('heading')}
          </h2>
          <p className="mt-1 text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('body')}
          </p>
          <p className="mt-1 text-xs text-helper">
            {t('willPost', { count: connectedAccounts.length })}
          </p>
        </div>
        {isPublished ? (
          <button
            type="button"
            onClick={() => submit()}
            disabled={posting}
            className="btn-primary inline-flex h-10 shrink-0 items-center px-5 disabled:opacity-50"
          >
            {posting ? t('posting') : t('shareNow')}
          </button>
        ) : null}
      </header>

      {/* Pre-flight account list */}
      <ul className="mt-4 space-y-1.5">
        {connectedAccounts.map((a) => (
          <li
            key={`${a.platform}:${a.externalAccountId}`}
            className="flex items-center gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
          >
            <span aria-hidden="true">{PLATFORM_EMOJI[a.platform]}</span>
            <span className="font-medium text-ink dark:text-ink-inverse">
              {a.displayName ?? a.externalAccountId}
            </span>
          </li>
        ))}
      </ul>

      {!isPublished && (
        <p
          role="status"
          className="mt-4 rounded-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
        >
          {t('draftNotice')}
        </p>
      )}

      {serverError && (
        <p
          role="alert"
          className="mt-4 rounded-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-800 dark:text-red-200"
        >
          {serverError}
        </p>
      )}

      {/* Result panel */}
      {attempts && attempts.length > 0 && (
        <div className="mt-5 space-y-2">
          {attempts.map((a) => (
            <AttemptRow key={`${a.platform}:${a.externalAccountId}`} attempt={a} t={t} />
          ))}
          {failedRetryable.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() =>
                  submit(
                    Array.from(new Set(failedRetryable.map((a) => a.platform))),
                  )
                }
                disabled={posting}
                className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:bg-surface-deep dark:hover:bg-white/5"
              >
                {posting ? t('posting') : t('retryFailed')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AttemptRow({
  attempt,
  t,
}: {
  attempt: AttemptOutcome;
  t: ReturnType<typeof useTranslations<'social.share'>>;
}) {
  const tone =
    attempt.status === 'succeeded'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
      : attempt.status === 'failed'
        ? 'border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-200'
        : 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200';
  const icon =
    attempt.status === 'succeeded' ? '✓' : attempt.status === 'failed' ? '✗' : '⊖';
  return (
    <div className={`rounded-card border px-3 py-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="font-bold">
          {icon}
        </span>
        <span aria-hidden="true">{PLATFORM_EMOJI[attempt.platform]}</span>
        <span className="font-medium">
          {attempt.displayName ?? attempt.externalAccountId}
        </span>
        <span className="text-xs opacity-75">— {t(`outcome.${attempt.status}` as 'outcome.succeeded')}</span>
        {attempt.externalPostUrl && (
          <a
            href={attempt.externalPostUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto text-xs underline-offset-2 hover:underline"
          >
            {t('viewPost')} →
          </a>
        )}
      </div>
      {attempt.status !== 'succeeded' && attempt.errorMessage && (
        <p className="mt-1 text-xs opacity-90">
          {t('errorPrefix')}: {attempt.errorCode ? `${attempt.errorCode} — ` : ''}
          {attempt.errorMessage}
        </p>
      )}
    </div>
  );
}
