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
  supportRef?: string;
}

const SUPPORT_EMAIL = 'info@advertisehomes.online';

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

/** Drafter response from /api/social/ai-draft. */
interface DraftResponse {
  ok: boolean;
  drafts: {
    facebook?: { message: string };
    instagram?: { caption: string };
    linkedin?: {
      commentary: string;
      contentTitle: string;
      contentDescription: string;
    };
  };
  aiErrorCode?: string;
}

/** Distinct set of platforms across the agent's connected accounts.
 *  (One agent might have 2 FB Pages but only one "facebook" draft.) */
function distinctPlatforms(accounts: ConnectedAccount[]): SharePlatform[] {
  return Array.from(new Set(accounts.map((a) => a.platform)));
}

/** Soft caps mirroring src/lib/social/post-formatter.ts. Surfaced in the
 *  UI as character counters. */
const PLATFORM_CAPS: Record<SharePlatform, number> = {
  facebook: 4000,
  instagram: 2000,
  linkedin: 2800,
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

  // Phase J — AI draft editor state.
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<DraftResponse['drafts'] | null>(null);
  const [edits, setEdits] = useState<Partial<Record<SharePlatform, string>>>({});

  // Per-account selection. Default = all checked (current behaviour).
  // Agent unchecks accounts they don't want to post to (e.g. has 7 FB
  // Pages but only wants to share to the AHO Page + their personal page).
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    () => new Set(connectedAccounts.map((a) => a.externalAccountId)),
  );
  const toggleAccount = (id: string) =>
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectAll = () =>
    setSelectedAccountIds(
      new Set(connectedAccounts.map((a) => a.externalAccountId)),
    );
  const selectNone = () => setSelectedAccountIds(new Set());
  const [aiUnavailable, setAiUnavailable] = useState(false);

  const platformsInScope = distinctPlatforms(connectedAccounts);

  async function generateDrafts() {
    setDrafting(true);
    setAiUnavailable(false);
    setServerError(null);
    try {
      const res = await fetch('/api/social/ai-draft', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          locale,
          platforms: platformsInScope,
        }),
      });
      const json = (await res.json()) as DraftResponse | {
        ok: false;
        errorCode: string;
      };
      if (!res.ok) {
        // Hard 4xx/5xx: the AI route itself failed (auth, plan, listing
        // not published, etc). Surface as a top-level server error.
        const code = 'errorCode' in json ? json.errorCode : `http_${res.status}`;
        setServerError(t('serverErrorCode', { code }));
        return;
      }
      const dr = json as DraftResponse;
      if (!dr.ok || !dr.drafts || Object.keys(dr.drafts).length === 0) {
        // Soft failure: Anthropic timed out, rate-limited, refused, etc.
        // We show a small inline note and let the agent share with the
        // deterministic template (no overrides) — flow is never blocked.
        setAiUnavailable(true);
        return;
      }
      setDrafts(dr.drafts);
      // Seed the editor with the AI's text so the agent can edit in-place.
      const seeded: Partial<Record<SharePlatform, string>> = {};
      if (dr.drafts.facebook) seeded.facebook = dr.drafts.facebook.message;
      if (dr.drafts.instagram) seeded.instagram = dr.drafts.instagram.caption;
      if (dr.drafts.linkedin) seeded.linkedin = dr.drafts.linkedin.commentary;
      setEdits(seeded);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('unexpectedError'));
    } finally {
      setDrafting(false);
    }
  }

  function resetDraft(platform: SharePlatform) {
    if (!drafts) return;
    const original =
      platform === 'facebook'
        ? drafts.facebook?.message
        : platform === 'instagram'
          ? drafts.instagram?.caption
          : platform === 'linkedin'
            ? drafts.linkedin?.commentary
            : undefined;
    if (original != null) setEdits((e) => ({ ...e, [platform]: original }));
  }

  function clearDraft(platform: SharePlatform) {
    setEdits((e) => {
      const next = { ...e };
      delete next[platform];
      return next;
    });
  }

  async function submit(platformsToInclude?: SharePlatform[]) {
    setPosting(true);
    setServerError(null);
    try {
      // Build per-platform overrides from the non-empty edits. A
      // platform with no edit (or empty string after the agent cleared
      // it) submits without override → server uses the deterministic
      // formatter.
      const overrides: {
        facebook?: { message: string };
        instagram?: { caption: string };
        linkedin?: { commentary: string };
      } = {};
      if (edits.facebook && edits.facebook.trim().length > 0) {
        overrides.facebook = { message: edits.facebook };
      }
      if (edits.instagram && edits.instagram.trim().length > 0) {
        overrides.instagram = { caption: edits.instagram };
      }
      if (edits.linkedin && edits.linkedin.trim().length > 0) {
        overrides.linkedin = { commentary: edits.linkedin };
      }
      const hasOverrides = Object.keys(overrides).length > 0;

      // Only send accountIds when the user has narrowed selection
      // below the full set (avoid sending a redundant filter that says
      // "all accounts" — both forms are equivalent server-side, but
      // omitting the field keeps the network payload + audit logs cleaner).
      const isFullSelection =
        selectedAccountIds.size === connectedAccounts.length;
      const res = await fetch('/api/social/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          propertyId,
          locale,
          ...(platformsToInclude ? { platforms: platformsToInclude } : {}),
          ...(isFullSelection
            ? {}
            : { accountIds: [...selectedAccountIds] }),
          ...(hasOverrides ? { overrides } : {}),
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
            {t('willPost', { count: selectedAccountIds.size })}
          </p>
        </div>
        {isPublished ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generateDrafts}
              disabled={drafting || posting}
              className="inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm transition hover:bg-black/5 disabled:opacity-50 dark:bg-surface-deep dark:hover:bg-white/5"
            >
              {drafting
                ? t('generating')
                : drafts
                  ? t('regenerateDraft')
                  : t('generateDraft')}
            </button>
            <button
              type="button"
              onClick={() => submit()}
              disabled={posting || drafting || selectedAccountIds.size === 0}
              className="btn-primary inline-flex h-10 items-center px-5 disabled:opacity-50"
              title={
                selectedAccountIds.size === 0 ? t('selectAtLeastOne') : undefined
              }
            >
              {posting ? t('posting') : t('shareNow')}
            </button>
          </div>
        ) : null}
      </header>

      {/* Pre-flight account list — checkboxes let the agent narrow
          the post to a subset (e.g. 7 FB Pages connected, only 2 are
          on-brand for this listing). Default = all checked. */}
      <fieldset className="mt-4">
        <legend className="sr-only">{t('accountSelectionLegend')}</legend>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-helper">
          <span>{t('accountSelectionHint')}</span>
          <span className="inline-flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="underline-offset-2 hover:underline disabled:opacity-50"
              disabled={selectedAccountIds.size === connectedAccounts.length}
            >
              {t('accountSelectAll')}
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={selectNone}
              className="underline-offset-2 hover:underline disabled:opacity-50"
              disabled={selectedAccountIds.size === 0}
            >
              {t('accountSelectNone')}
            </button>
          </span>
        </div>
        <ul className="space-y-1.5">
          {connectedAccounts.map((a) => {
            const checked = selectedAccountIds.has(a.externalAccountId);
            return (
              <li
                key={`${a.platform}:${a.externalAccountId}`}
                className="flex items-center gap-2 text-sm"
              >
                <label className="inline-flex flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAccount(a.externalAccountId)}
                    className="h-4 w-4 rounded-sm border-border-strong text-action focus:ring-action"
                  />
                  <span aria-hidden="true">{PLATFORM_EMOJI[a.platform]}</span>
                  <span
                    className={
                      checked
                        ? 'font-medium text-ink dark:text-ink-inverse'
                        : 'text-ink-muted line-through opacity-60 dark:text-ink-inverse-muted'
                    }
                  >
                    {a.displayName ?? a.externalAccountId}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {!isPublished && (
        <p
          role="status"
          className="mt-4 rounded-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
        >
          {t('draftNotice')}
        </p>
      )}

      {/* Phase J — AI draft editor. Shows only after Generate is
          clicked; textareas pre-fill with AI text, agent edits in place,
          Share now submits the edited text as `overrides`. */}
      {drafts && (
        <div className="mt-5 space-y-3">
          <p className="text-xs text-helper">{t('reviewBeforeShare')}</p>
          {platformsInScope.map((platform) => {
            if (
              (platform === 'facebook' && !drafts.facebook) ||
              (platform === 'instagram' && !drafts.instagram) ||
              (platform === 'linkedin' && !drafts.linkedin)
            ) {
              return null;
            }
            const value = edits[platform] ?? '';
            const cap = PLATFORM_CAPS[platform];
            return (
              <div
                key={platform}
                className="rounded-card border border-border bg-surface-muted/40 p-3 dark:border-border-strong/40 dark:bg-surface-dark/40"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink dark:text-ink-inverse">
                    {PLATFORM_EMOJI[platform]}{' '}
                    {platform === 'facebook'
                      ? 'Facebook'
                      : platform === 'instagram'
                        ? 'Instagram'
                        : 'LinkedIn'}
                  </span>
                  <span
                    className={
                      value.length > cap
                        ? 'text-xs font-mono text-red-700 dark:text-red-300'
                        : 'text-xs font-mono text-helper'
                    }
                  >
                    {value.length}/{cap}
                  </span>
                </div>
                <textarea
                  value={value}
                  onChange={(e) =>
                    setEdits((prev) => ({ ...prev, [platform]: e.target.value }))
                  }
                  rows={platform === 'instagram' ? 8 : 6}
                  className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] leading-relaxed shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  aria-label={t(
                    `platformDraftLabel.${platform}` as 'platformDraftLabel.facebook',
                  )}
                />
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() => resetDraft(platform)}
                    className="text-helper underline-offset-2 hover:underline"
                  >
                    {t('resetDraft')}
                  </button>
                  <button
                    type="button"
                    onClick={() => clearDraft(platform)}
                    className="text-helper underline-offset-2 hover:underline"
                  >
                    {t('useTemplate')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {aiUnavailable && (
        <p
          role="status"
          className="mt-4 rounded-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
        >
          {t('aiUnavailable')}
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
            <AttemptRow
              key={`${a.platform}:${a.externalAccountId}`}
              attempt={a}
              t={t}
              propertyId={propertyId}
              siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? ''}
            />
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
  propertyId,
  siteUrl,
}: {
  attempt: AttemptOutcome;
  t: ReturnType<typeof useTranslations<'social.share'>>;
  propertyId: string;
  siteUrl: string;
}) {
  const tone =
    attempt.status === 'succeeded'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200'
      : attempt.status === 'failed'
        ? 'border-red-500/30 bg-red-500/5 text-red-800 dark:text-red-200'
        : 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200';
  const icon =
    attempt.status === 'succeeded' ? '✓' : attempt.status === 'failed' ? '✗' : '⊖';
  const [copied, setCopied] = useState(false);

  async function copyRef() {
    if (!attempt.supportRef) return;
    try {
      await navigator.clipboard.writeText(attempt.supportRef);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (insecure context / permissions) — silently no-op.
      // The agent can still select-and-copy the visible <code> manually.
    }
  }

  // Build a mailto: link with the supportRef pre-filled in subject + body.
  // Only relevant for failed (not skipped) attempts — skipped means
  // "agent fixes a precondition themselves", not "ask support for help".
  const showSupportControls =
    attempt.status === 'failed' && !!attempt.supportRef;
  const mailtoHref = showSupportControls
    ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
        t('mailtoSubject', { ref: attempt.supportRef! }),
      )}&body=${encodeURIComponent(
        t('mailtoBody', {
          ref: attempt.supportRef!,
          platform: attempt.platform,
          account: attempt.displayName ?? attempt.externalAccountId,
          listingUrl: `${siteUrl}/dashboard/properties/${propertyId}`,
        }),
      )}`
    : null;

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
      {showSupportControls && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="opacity-75">{t('errorRefLabel')}:</span>
          <code className="rounded border border-current/30 bg-current/5 px-1.5 py-0.5 font-mono">
            {attempt.supportRef}
          </code>
          <button
            type="button"
            onClick={copyRef}
            className="inline-flex h-7 items-center rounded-md border border-current/30 px-2 transition hover:bg-current/5"
            aria-label={t('copyError')}
          >
            {copied ? t('copyErrorCopied') : t('copyError')}
          </button>
          {mailtoHref && (
            <a
              href={mailtoHref}
              className="inline-flex h-7 items-center rounded-md border border-current/30 px-2 transition hover:bg-current/5"
            >
              {t('emailSupport')}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
