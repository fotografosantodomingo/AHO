'use client';

import { useCallback, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { LOCALES, type Locale } from '@/i18n/config';

/**
 * Multi-locale FAQ editor for the agent dashboard. Supports all 7 AHO
 * locales (EN, ES, PL, PT, DE, FR, IT). Each FAQ row stores up to one
 * (question, answer) pair per locale; the public profile page renders
 * the visitor's active locale with EN fallback (per migration 0035 +
 * `pickFaq()` in lib/listings/search.ts).
 *
 * UX (PO directive 2026-05-07: "if Polish is selected, FAQ should also
 * be in Polish"):
 *   - Each row's edit pane shows ONE locale at a time, defaulting to
 *     the agent's UI locale. Tabs at the top let them switch to add
 *     translations for other locales.
 *   - Tabs that already have content show a filled indicator (the
 *     locale code stays bold).
 *   - Save writes the whole row's locale map in one round-trip; the
 *     CHECK constraint enforces "at least one locale pair filled".
 *
 * Sort order computed at write time (last-row + 1 on insert). No DnD
 * yet — adds bundle weight without enough payoff for ≤10 FAQs.
 */

type LocaleMap = Record<Locale, { q: string; a: string }>;

const EMPTY_LOCALE_MAP: LocaleMap = {
  en: { q: '', a: '' },
  es: { q: '', a: '' },
  pl: { q: '', a: '' },
  pt: { q: '', a: '' },
  de: { q: '', a: '' },
  fr: { q: '', a: '' },
  it: { q: '', a: '' },
};

interface FaqRow {
  id: string;
  questionEn: string;
  questionEs: string;
  answerEn: string;
  answerEs: string;
  questionPl: string;
  questionPt: string;
  questionDe: string;
  questionFr: string;
  questionIt: string;
  answerPl: string;
  answerPt: string;
  answerDe: string;
  answerFr: string;
  answerIt: string;
  sortOrder: number;
}

interface DraftRow {
  id: string | null;
  data: LocaleMap;
  /** Which locale's Q+A is currently visible in the edit pane. Doesn't
   *  affect persisted data — purely a UI cursor. */
  activeTab: Locale;
  sortOrder: number;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

function fromPersisted(r: FaqRow, defaultTab: Locale): DraftRow {
  return {
    id: r.id,
    data: {
      en: { q: r.questionEn, a: r.answerEn },
      es: { q: r.questionEs, a: r.answerEs },
      pl: { q: r.questionPl, a: r.answerPl },
      pt: { q: r.questionPt, a: r.answerPt },
      de: { q: r.questionDe, a: r.answerDe },
      fr: { q: r.questionFr, a: r.answerFr },
      it: { q: r.questionIt, a: r.answerIt },
    },
    activeTab: defaultTab,
    sortOrder: r.sortOrder,
    dirty: false,
    saving: false,
    error: null,
  };
}

function blankDraft(sortOrder: number, defaultTab: Locale): DraftRow {
  return {
    id: null,
    data: structuredClone(EMPTY_LOCALE_MAP),
    activeTab: defaultTab,
    sortOrder,
    dirty: true,
    saving: false,
    error: null,
  };
}

interface Props {
  orgId: string;
  /** UI locale of the dashboard — used as the default editing tab so
   *  agents on /pl/dashboard land on the PL tab, /es agents on ES, etc. */
  locale: Locale;
  initialFaqs: FaqRow[];
}

export function FaqEditor({ orgId, locale, initialFaqs }: Props) {
  const t = useTranslations('dashboardFaqs');
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [rows, setRows] = useState<DraftRow[]>(
    initialFaqs.map((r) => fromPersisted(r, locale)),
  );
  const [pending, startTransition] = useTransition();

  function patchRow(idx: number, patch: Partial<DraftRow>): void {
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)),
    );
  }

  function patchActiveLocale(idx: number, patch: Partial<{ q: string; a: string }>): void {
    setRows((rs) =>
      rs.map((r, i) => {
        if (i !== idx) return r;
        const cur = r.data[r.activeTab];
        return {
          ...r,
          data: { ...r.data, [r.activeTab]: { ...cur, ...patch } },
          dirty: true,
        };
      }),
    );
  }

  function setActiveTab(idx: number, tab: Locale): void {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, activeTab: tab } : r)));
  }

  function addBlank(): void {
    setRows((rs) => [...rs, blankDraft(rs.length, locale)]);
  }

  const saveRow = useCallback(
    async (idx: number) => {
      const row = rows[idx];
      if (!row) return;
      // Per-locale "both Q and A or neither". Server CHECK constraint
      // also enforces at-least-one-pair, but we surface the error
      // client-side so the agent doesn't see an opaque 400.
      const filled: Partial<Record<Locale, boolean>> = {};
      const halfFilled: Locale[] = [];
      for (const loc of LOCALES) {
        const { q, a } = row.data[loc];
        const qSet = q.trim().length > 0;
        const aSet = a.trim().length > 0;
        if (qSet && aSet) filled[loc] = true;
        else if (qSet || aSet) halfFilled.push(loc);
      }
      if (halfFilled.length > 0) {
        patchRow(idx, { error: t('errorPartial') });
        return;
      }
      if (Object.keys(filled).length === 0) {
        patchRow(idx, { error: t('errorEmpty') });
        return;
      }

      patchRow(idx, { saving: true, error: null });

      // Build a payload that nulls every unfilled locale's columns and
      // sets the trimmed values for filled ones. PostgREST writes only
      // the keys we provide on insert; on update, omitted keys keep
      // their existing value, so we explicitly null the empties.
      const payload: Record<string, string | number | null> = {
        org_id: orgId,
        sort_order: row.sortOrder,
      };
      for (const loc of LOCALES) {
        const { q, a } = row.data[loc];
        const qSet = q.trim().length > 0;
        const aSet = a.trim().length > 0;
        payload[`question_${loc}`] = qSet && aSet ? q.trim() : null;
        payload[`answer_${loc}`] = qSet && aSet ? a.trim() : null;
      }

      const { data, error } = row.id
        ? await supabase
            .from('agent_faqs')
            .update(payload)
            .eq('id', row.id)
            .select()
            .maybeSingle()
        : await supabase.from('agent_faqs').insert(payload).select().maybeSingle();

      if (error || !data) {
        patchRow(idx, { saving: false, error: error?.message ?? t('errorSaveFailed') });
        return;
      }

      setRows((rs) =>
        rs.map((r, i) =>
          i === idx
            ? {
                id: data.id as string,
                activeTab: r.activeTab,
                sortOrder: data.sort_order as number,
                data: {
                  en: {
                    q: (data.question_en as string | null) ?? '',
                    a: (data.answer_en as string | null) ?? '',
                  },
                  es: {
                    q: (data.question_es as string | null) ?? '',
                    a: (data.answer_es as string | null) ?? '',
                  },
                  pl: {
                    q: (data.question_pl as string | null) ?? '',
                    a: (data.answer_pl as string | null) ?? '',
                  },
                  pt: {
                    q: (data.question_pt as string | null) ?? '',
                    a: (data.answer_pt as string | null) ?? '',
                  },
                  de: {
                    q: (data.question_de as string | null) ?? '',
                    a: (data.answer_de as string | null) ?? '',
                  },
                  fr: {
                    q: (data.question_fr as string | null) ?? '',
                    a: (data.answer_fr as string | null) ?? '',
                  },
                  it: {
                    q: (data.question_it as string | null) ?? '',
                    a: (data.answer_it as string | null) ?? '',
                  },
                },
                dirty: false,
                saving: false,
                error: null,
              }
            : r,
        ),
      );
      startTransition(() => router.refresh());
    },
    [orgId, rows, supabase, t, router],
  );

  async function deleteRow(idx: number): Promise<void> {
    const row = rows[idx];
    if (!row) return;
    if (row.id) {
      patchRow(idx, { saving: true });
      const { error } = await supabase.from('agent_faqs').delete().eq('id', row.id);
      if (error) {
        patchRow(idx, { saving: false, error: error.message });
        return;
      }
    }
    setRows((rs) => rs.filter((_, i) => i !== idx));
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-8 text-center text-sm text-helper">
          {t('emptyHint')}
        </div>
      ) : (
        rows.map((row, idx) => {
          const active = row.data[row.activeTab];
          return (
            <div
              key={row.id ?? `draft-${idx}`}
              className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
            >
              {/* Locale tabs. Each tab shows the locale code; tabs whose
                  Q+A pair is filled get a bold weight + green dot. */}
              <div
                role="tablist"
                aria-label={t('localeTabsLabel')}
                className="flex flex-wrap gap-1"
              >
                {LOCALES.map((loc) => {
                  const data = row.data[loc];
                  const isFilled = data.q.trim().length > 0 && data.a.trim().length > 0;
                  const isActive = row.activeTab === loc;
                  return (
                    <button
                      key={loc}
                      role="tab"
                      type="button"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(idx, loc)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium uppercase tracking-wider transition ${
                        isActive
                          ? 'border-action bg-action/10 text-action dark:border-action-dark dark:bg-action-dark/15 dark:text-action-dark'
                          : 'border-border-strong bg-surface hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5'
                      } ${isFilled ? 'font-semibold' : ''}`}
                    >
                      {loc}
                      {isFilled && (
                        <span
                          aria-label={t('filledIndicator')}
                          className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <Field label={t('questionLabel', { locale: row.activeTab.toUpperCase() })}>
                <input
                  type="text"
                  value={active.q}
                  onChange={(e) => patchActiveLocale(idx, { q: e.target.value })}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  placeholder={t('placeholderQuestion')}
                />
              </Field>
              <Field label={t('answerLabel', { locale: row.activeTab.toUpperCase() })}>
                <textarea
                  value={active.a}
                  onChange={(e) => patchActiveLocale(idx, { a: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  placeholder={t('placeholderAnswer')}
                />
              </Field>

              {row.error && (
                <p role="alert" className="text-sm text-red-600">
                  {row.error}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveRow(idx)}
                  disabled={row.saving || (!row.dirty && !!row.id)}
                  className="btn-primary h-9 px-4 disabled:opacity-50"
                >
                  {row.saving ? t('saving') : row.id ? t('save') : t('publish')}
                </button>
                <button
                  type="button"
                  onClick={() => deleteRow(idx)}
                  disabled={row.saving}
                  className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
                >
                  {t('delete')}
                </button>
                {row.id && !row.dirty && (
                  <span className="text-xs text-helper">{t('savedHint')}</span>
                )}
              </div>
            </div>
          );
        })
      )}
      <button
        type="button"
        onClick={addBlank}
        disabled={pending}
        className="inline-flex h-10 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm font-medium transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
      >
        + {t('addFaq')}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
