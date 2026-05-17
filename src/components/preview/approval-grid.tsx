'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DrafterResult } from '@/lib/social/ai-drafter';

/**
 * Approval grid — Phase 3 of docs/SUPER_PRO_STAGE_1_PLAN.md.
 *
 * Rendered on /preview/[auditId] for the authed agent who claimed the
 * audit. Shows a 3-locale × 3-platform matrix of checkboxes. Hitting
 * "Publish approved (N)" POSTs the selected (locale, platform) pairs
 * to /api/audit/[id]/publish which fans out to the existing
 * publishToFacebookPage / publishToInstagramBusiness / publishToLinkedIn
 * primitives.
 *
 * Status reflection:
 *   - `publishedResults` arrives from the server with prior attempts;
 *     a cell with an `ok:true` entry shows ✓ and disables its checkbox
 *     (no double-publish); a cell with an `ok:false` entry shows the
 *     error and re-enables for retry.
 *   - When the POST returns, we merge the new results client-side and
 *     re-render without a hard nav.
 *
 * Partial-success semantics: the API returns `{ok: true, results: [...]}`
 * with per-cell ok/error — so one failed IG publish doesn't mark the
 * whole submission as failed.
 */

type Locale = 'en' | 'es' | 'pl';
type Platform = 'facebook' | 'instagram' | 'linkedin';

interface PublishedResult {
  locale: Locale;
  platform: Platform;
  ok: boolean;
  external_post_id?: string;
  external_post_url?: string;
  error_code?: string;
  error_message?: string;
  attempted_at: string;
}

interface PlatformAccount {
  externalAccountId: string;
  displayName: string | null;
}

interface PlatformConnection {
  platform: Platform;
  /** All accounts the user has for this platform. Empty array = not
   *  connected. Length 1 = single account (no picker needed). Length
   *  > 1 = multi-account; grid renders a selector so the agent picks
   *  which one to publish to. */
  accounts: PlatformAccount[];
}

interface Props {
  auditId: string;
  /** Page locale — used to build the OAuth returnTo and the
   *  /dashboard/social fallback path so Connect → bounces back to
   *  this exact preview after OAuth completes. */
  locale: 'en' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';
  drafts: Record<Locale, DrafterResult>;
  publishedResults: PublishedResult[];
  /** Per-platform connection state (Phase 4 slice 4d / easier OAuth UX).
   *  When a platform isn't connected, the grid surfaces an inline
   *  "Connect →" link to the right OAuth start route — agent fixes
   *  the missing connection where they hit it, no navigation needed. */
  connections: PlatformConnection[];
}

const LOCALES: Locale[] = ['en', 'es', 'pl'];
const PLATFORMS: Platform[] = ['facebook', 'instagram', 'linkedin'];
const LOCALE_LABEL_KEY: Record<Locale, 'localeEn' | 'localeEs' | 'localePl'> = {
  en: 'localeEn',
  es: 'localeEs',
  pl: 'localePl',
};

function cellKey(locale: Locale, platform: Platform): string {
  return `${locale}::${platform}`;
}

export function ApprovalGrid({
  auditId,
  locale,
  drafts,
  publishedResults,
  connections,
}: Props) {
  const t = useTranslations('freeAudit');
  // Latest result wins for any (locale, platform) — array order is
  // chronological since the server appends without dedup.
  const [results, setResults] = useState<PublishedResult[]>(publishedResults);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  // Phase 3.5: per-platform account selection. Defaults to the first
  // account per platform (matches the prior single-account behavior);
  // agency users with multiple FB Pages can override via the picker
  // that the connection pill renders when accounts.length > 1.
  const connectedMap = useMemo(() => {
    const m = new Map<Platform, PlatformConnection>();
    for (const c of connections) m.set(c.platform, c);
    return m;
  }, [connections]);

  const [selectedAccount, setSelectedAccount] = useState<
    Record<Platform, string | null>
  >({
    facebook: connectedMap.get('facebook')?.accounts[0]?.externalAccountId ?? null,
    instagram: connectedMap.get('instagram')?.accounts[0]?.externalAccountId ?? null,
    linkedin: connectedMap.get('linkedin')?.accounts[0]?.externalAccountId ?? null,
  });

  const latestByCell = useMemo(() => {
    const m = new Map<string, PublishedResult>();
    for (const r of results) m.set(cellKey(r.locale, r.platform), r);
    return m;
  }, [results]);

  function hasDraft(loc: Locale, platform: Platform): boolean {
    const bundle = drafts[loc];
    if (!bundle?.drafts) return false;
    if (platform === 'facebook') return !!bundle.drafts.facebook?.message;
    if (platform === 'instagram') return !!bundle.drafts.instagram?.caption;
    return !!bundle.drafts.linkedin?.commentary;
  }

  function isConnected(platform: Platform): boolean {
    return (connectedMap.get(platform)?.accounts.length ?? 0) > 0;
  }

  function accountsFor(platform: Platform): PlatformAccount[] {
    return connectedMap.get(platform)?.accounts ?? [];
  }

  // OAuth start URLs preserve a `returnTo` so the callback bounces
  // straight back to this audit preview after the agent finishes the
  // platform's consent screen. No extra navigation.
  const returnTo = `/${locale}/preview/${auditId}`;
  const connectUrl = (platform: Platform): string => {
    const rt = encodeURIComponent(returnTo);
    if (platform === 'facebook' || platform === 'instagram') {
      // Meta OAuth covers BOTH FB Page + IG Business in one flow
      // (IG comes through if the agent has it linked to a Page in
      // Meta Business Suite — see /instagram-setup if missing).
      return `/api/oauth/meta/start?returnTo=${rt}`;
    }
    return `/api/oauth/linkedin/start?returnTo=${rt}`;
  };

  function toggle(locale: Locale, platform: Platform) {
    const k = cellKey(locale, platform);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function publish() {
    if (submitting || selected.size === 0) return;
    setTopError(null);
    setSubmitting(true);
    try {
      const selections = Array.from(selected).map((k) => {
        const [locale, platform] = k.split('::') as [Locale, Platform];
        return { locale, platform };
      });
      // accountIds = per-platform externalAccountId picked from the
      // multi-account selector. Omitted entries fall back to "first
      // account on the platform" server-side (status-quo behavior for
      // single-account users).
      const accountIds: Record<string, string> = {};
      for (const p of ['facebook', 'instagram', 'linkedin'] as const) {
        const chosen = selectedAccount[p];
        if (chosen) accountIds[p] = chosen;
      }
      const res = await fetch(`/api/audit/${auditId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selections, accountIds }),
      });
      const json = (await res.json()) as
        | { ok: true; results: PublishedResult[] }
        | { ok: false; error: string; hint?: string };
      if (!res.ok || !('ok' in json) || !json.ok) {
        setTopError(
          'error' in json
            ? t.has(`publishError.${json.error}` as 'publishError.unauthenticated')
              ? t(`publishError.${json.error}` as 'publishError.unauthenticated')
              : json.error
            : 'unknown',
        );
        return;
      }
      // Merge per-cell results — append; latestByCell picks the newest.
      setResults((prev) => [...prev, ...json.results]);
      // Clear successful selections; keep failed ones checked so the
      // user can immediately re-publish after fixing the root cause
      // (eg connecting IG).
      const successKeys = new Set(
        json.results.filter((r) => r.ok).map((r) => cellKey(r.locale, r.platform)),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of successKeys) next.delete(k);
        return next;
      });
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="approval-grid-heading"
      className="mt-12 rounded-card border border-action/30 bg-action/5 p-6 md:p-8"
    >
      <header className="space-y-2">
        <h2
          id="approval-grid-heading"
          className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]"
        >
          {t('approvalHeading')}
        </h2>
        <p className="text-sm text-ink-muted">{t('approvalSub')}</p>
      </header>

      {/* Connection state strip — slice 4d / easier OAuth UX. One pill
          per platform showing ✓ Connected as "{name}" or a "Connect →"
          link straight to the OAuth start, with returnTo preserved so
          the agent lands back here after consent. Removes the prior
          friction of needing to navigate to /dashboard/social just to
          enable a publish target. */}
      <ul className="mt-4 flex flex-wrap items-center gap-2">
        {PLATFORMS.map((p) => {
          const accts = accountsFor(p);
          const label =
            p === 'facebook' ? '📘 Facebook' : p === 'instagram' ? '📷 Instagram' : '💼 LinkedIn';
          if (accts.length === 0) {
            return (
              <li key={p}>
                <a
                  href={connectUrl(p)}
                  className="inline-flex items-center gap-1 rounded-full border border-action/40 bg-surface px-3 py-1 text-xs font-medium text-action transition hover:bg-action/5"
                >
                  <span>{label}</span>
                  <span aria-hidden="true">·</span>
                  <span>{t('approvalConnect')} →</span>
                </a>
              </li>
            );
          }
          // Connected. If exactly one account, render the pill as
          // before (no picker). If multiple, render an inline <select>
          // so agency users can pick which Page/IG/LinkedIn-profile
          // to publish to without leaving the preview.
          if (accts.length === 1) {
            const only = accts[0]!;
            return (
              <li key={p}>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800"
                  title={only.displayName ?? undefined}
                >
                  <span>{label}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold">✓</span>
                  {only.displayName && (
                    <span className="max-w-[14ch] truncate opacity-80">
                      {only.displayName}
                    </span>
                  )}
                </span>
              </li>
            );
          }
          return (
            <li key={p}>
              <label className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                <span>{label}</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold">✓</span>
                <select
                  value={selectedAccount[p] ?? ''}
                  onChange={(e) =>
                    setSelectedAccount((prev) => ({
                      ...prev,
                      [p]: e.target.value || null,
                    }))
                  }
                  disabled={submitting}
                  aria-label={t('approvalAccountPicker', { count: accts.length })}
                  className="cursor-pointer rounded-md border-none bg-transparent px-1 py-0 text-xs font-medium text-emerald-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
                >
                  {accts.map((a) => (
                    <option
                      key={a.externalAccountId}
                      value={a.externalAccountId}
                    >
                      {a.displayName ?? a.externalAccountId}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[520px] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-helper">
              <th className="px-3 py-2">{t('approvalLocaleCol')}</th>
              {PLATFORMS.map((p) => (
                <th key={p} className="px-3 py-2 text-center">
                  {p === 'facebook' ? '📘 FB' : p === 'instagram' ? '📷 IG' : '💼 LinkedIn'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LOCALES.map((loc) => (
              <tr key={loc} className="rounded-lg bg-surface">
                <td className="rounded-l-lg px-3 py-3 font-medium">
                  {t(LOCALE_LABEL_KEY[loc])}
                </td>
                {PLATFORMS.map((plat) => {
                  const k = cellKey(loc, plat);
                  const latest = latestByCell.get(k);
                  const ok = latest?.ok === true;
                  const failed = latest?.ok === false;
                  const draftExists = hasDraft(loc, plat);
                  const platConnected = isConnected(plat);
                  const checked = selected.has(k);
                  const disabled =
                    ok || !draftExists || !platConnected || submitting;
                  return (
                    <td
                      key={plat}
                      className="px-3 py-3 text-center align-middle"
                    >
                      {ok ? (
                        <span
                          title={latest?.external_post_url}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800"
                        >
                          ✓ {t('approvalPosted')}
                        </span>
                      ) : (
                        <label className="inline-flex flex-col items-center gap-1">
                          <input
                            type="checkbox"
                            checked={checked && !disabled}
                            disabled={disabled}
                            onChange={() => toggle(loc, plat)}
                            className="h-5 w-5 cursor-pointer rounded border-border-strong accent-action disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`${loc} ${plat}`}
                          />
                          {!draftExists && (
                            <span className="text-[10px] text-helper">
                              {t('approvalNoDraft')}
                            </span>
                          )}
                          {draftExists && !platConnected && (
                            <span className="text-[10px] text-helper">
                              {t('approvalNotConnected')}
                            </span>
                          )}
                          {failed && (
                            <span
                              title={latest?.error_message}
                              className="text-[10px] font-medium text-red-700"
                            >
                              ✗ {latest?.error_code}
                            </span>
                          )}
                        </label>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {topError && (
        <p
          role="alert"
          className="mt-4 rounded-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-800"
        >
          {topError}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {t('approvalSelectedCount', { count: selected.size })}
        </p>
        <button
          type="button"
          onClick={publish}
          disabled={submitting || selected.size === 0}
          className="btn-primary inline-flex h-12 items-center px-6 text-base font-semibold disabled:opacity-50"
        >
          {submitting ? t('approvalPublishing') : t('approvalPublishCta', { count: selected.size })}
        </button>
      </div>
    </section>
  );
}
