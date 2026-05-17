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

interface Props {
  auditId: string;
  drafts: Record<Locale, DrafterResult>;
  publishedResults: PublishedResult[];
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

export function ApprovalGrid({ auditId, drafts, publishedResults }: Props) {
  const t = useTranslations('freeAudit');
  // Latest result wins for any (locale, platform) — array order is
  // chronological since the server appends without dedup.
  const [results, setResults] = useState<PublishedResult[]>(publishedResults);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const latestByCell = useMemo(() => {
    const m = new Map<string, PublishedResult>();
    for (const r of results) m.set(cellKey(r.locale, r.platform), r);
    return m;
  }, [results]);

  function hasDraft(locale: Locale, platform: Platform): boolean {
    const bundle = drafts[locale];
    if (!bundle?.drafts) return false;
    if (platform === 'facebook') return !!bundle.drafts.facebook?.message;
    if (platform === 'instagram') return !!bundle.drafts.instagram?.caption;
    return !!bundle.drafts.linkedin?.commentary;
  }

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
      const res = await fetch(`/api/audit/${auditId}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ selections }),
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
                  const checked = selected.has(k);
                  const disabled = ok || !draftExists || submitting;
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
                            checked={checked}
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
