'use client';

import { useCallback, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import type { Locale } from '@/i18n/config';

/**
 * Client-side FAQ editor for the agent dashboard. Uses the Supabase
 * browser client; RLS migration 0032 enforces that only the org's
 * owner/manager can write rows. Each row is bilingual — agents fill
 * EN, ES, or both. The DB CHECK constraint requires at least one
 * complete (Q+A) pair before insert/update.
 *
 * Sort order is computed at write time (last-row + 1 on insert; the
 * up/down buttons swap with the neighbor on reorder). No drag-and-drop
 * in v1 — adds bundle weight without enough payoff for ≤10 FAQs.
 */

interface FaqRow {
  id: string;
  questionEn: string;
  questionEs: string;
  answerEn: string;
  answerEs: string;
  sortOrder: number;
}

// Locally-edited row — `id` may be null for not-yet-persisted entries.
interface DraftRow {
  id: string | null;
  questionEn: string;
  questionEs: string;
  answerEn: string;
  answerEs: string;
  sortOrder: number;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

function fromPersisted(r: FaqRow): DraftRow {
  return { ...r, dirty: false, saving: false, error: null };
}

function blankDraft(sortOrder: number): DraftRow {
  return {
    id: null,
    questionEn: '',
    questionEs: '',
    answerEn: '',
    answerEs: '',
    sortOrder,
    dirty: true,
    saving: false,
    error: null,
  };
}

interface Props {
  orgId: string;
  locale: Locale;
  initialFaqs: FaqRow[];
}

export function FaqEditor({ orgId, locale, initialFaqs }: Props) {
  const t = useTranslations('dashboardFaqs');
  const router = useRouter();
  const supabase = getSupabaseBrowserClient();
  const [rows, setRows] = useState<DraftRow[]>(initialFaqs.map(fromPersisted));
  const [pending, startTransition] = useTransition();

  function patchRow(idx: number, patch: Partial<DraftRow>): void {
    setRows((rs) =>
      rs.map((r, i) => (i === idx ? { ...r, ...patch, dirty: true } : r)),
    );
  }

  function addBlank(): void {
    setRows((rs) => [...rs, blankDraft(rs.length)]);
  }

  const saveRow = useCallback(
    async (idx: number) => {
      const row = rows[idx];
      if (!row) return;
      // Both-or-neither rule per locale — partial Q-without-A is rejected
      // server-side by the CHECK constraint anyway, but flag client-side
      // so the agent doesn't get a confusing 400.
      const enFilled = !!(row.questionEn.trim() && row.answerEn.trim());
      const esFilled = !!(row.questionEs.trim() && row.answerEs.trim());
      const enHalf = !!(row.questionEn.trim() || row.answerEn.trim()) && !enFilled;
      const esHalf = !!(row.questionEs.trim() || row.answerEs.trim()) && !esFilled;
      if (enHalf || esHalf) {
        patchRow(idx, { error: t('errorPartial') });
        return;
      }
      if (!enFilled && !esFilled) {
        patchRow(idx, { error: t('errorEmpty') });
        return;
      }

      patchRow(idx, { saving: true, error: null });
      const payload = {
        org_id: orgId,
        question_en: enFilled ? row.questionEn.trim() : null,
        question_es: esFilled ? row.questionEs.trim() : null,
        answer_en: enFilled ? row.answerEn.trim() : null,
        answer_es: esFilled ? row.answerEs.trim() : null,
        sort_order: row.sortOrder,
      };

      const { data, error } = row.id
        ? await supabase.from('agent_faqs').update(payload).eq('id', row.id).select().maybeSingle()
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
                questionEn: (data.question_en as string | null) ?? '',
                questionEs: (data.question_es as string | null) ?? '',
                answerEn: (data.answer_en as string | null) ?? '',
                answerEs: (data.answer_es as string | null) ?? '',
                sortOrder: data.sort_order as number,
                dirty: false,
                saving: false,
                error: null,
              }
            : r,
        ),
      );
      // Refresh the public profile page metadata (next dynamic fetch
      // will pick up the new FAQ).
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
        rows.map((row, idx) => (
          <div
            key={row.id ?? `draft-${idx}`}
            className="space-y-3 rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('questionEn')}>
                <input
                  type="text"
                  value={row.questionEn}
                  onChange={(e) => patchRow(idx, { questionEn: e.target.value })}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  placeholder={t('placeholderQuestionEn')}
                />
              </Field>
              <Field label={t('questionEs')}>
                <input
                  type="text"
                  value={row.questionEs}
                  onChange={(e) => patchRow(idx, { questionEs: e.target.value })}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  placeholder={t('placeholderQuestionEs')}
                />
              </Field>
              <Field label={t('answerEn')}>
                <textarea
                  value={row.answerEn}
                  onChange={(e) => patchRow(idx, { answerEn: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  placeholder={t('placeholderAnswerEn')}
                />
              </Field>
              <Field label={t('answerEs')}>
                <textarea
                  value={row.answerEs}
                  onChange={(e) => patchRow(idx, { answerEs: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
                  placeholder={t('placeholderAnswerEs')}
                />
              </Field>
            </div>
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
                <span className="text-xs text-helper">
                  {t('savedHint')}{' '}
                  <a
                    href={`/${locale}/${locale === 'es' ? 'agentes' : 'agents'}/${''}`}
                    className="hidden"
                    aria-hidden="true"
                  />
                </span>
              )}
            </div>
          </div>
        ))
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
