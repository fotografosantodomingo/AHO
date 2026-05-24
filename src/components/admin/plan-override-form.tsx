'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const PLAN_OPTIONS: { id: PlanId; label: string }[] = [
  { id: 'aho_agent_monthly', label: 'Agent · monthly' },
  { id: 'aho_agent_annual', label: 'Agent · annual' },
  { id: 'aho_agent_founder_monthly', label: 'Agent · founder monthly ($19)' },
  { id: 'aho_plus_monthly', label: 'Plus · monthly' },
  { id: 'aho_plus_annual', label: 'Plus · annual' },
  { id: 'aho_pro_automation_monthly', label: 'Pro Automation · monthly' },
  { id: 'aho_pro_automation_annual', label: 'Pro Automation · annual' },
];

type PlanId = (typeof ALLOWED_PLAN_IDS)[number];

const ALLOWED_PLAN_IDS = [
  'aho_agent_monthly',
  'aho_agent_annual',
  'aho_agent_founder_monthly',
  'aho_plus_monthly',
  'aho_plus_annual',
  'aho_pro_automation_monthly',
  'aho_pro_automation_annual',
] as const;

const DURATION_PRESETS: { days: number | null; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days (soft-beta)' },
  { days: 180, label: '180 days' },
  { days: 365, label: '365 days' },
  { days: null, label: 'Permanent (Founding 50)' },
];

interface Props {
  orgId: string;
  orgName: string;
  currentPlanId: string | null;
  manualPlanId: string | null;
  manualPlanExpiresAt: string | null;
  manualPlanNote: string | null;
}

/**
 * Admin form for grant/extend/revoke of a manual plan override.
 *
 * Three modes the operator picks via tabs:
 *   - Grant: pick tier + duration (presets or permanent) + note
 *   - Extend: add N days to the active override's expires_at
 *   - Revoke: clears the override; org falls back to Stripe plan
 *
 * Submits to /api/admin/orgs/[id]/plan-override which validates
 * admin again server-side + writes to audit_log.
 */
export function PlanOverrideForm(props: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'grant' | 'extend' | 'revoke'>('grant');

  // Grant mode state
  const [planId, setPlanId] = useState<PlanId>(
    (props.manualPlanId as PlanId | null) ?? 'aho_pro_automation_monthly',
  );
  const [days, setDays] = useState<number | null>(90);
  const [note, setNote] = useState(props.manualPlanNote ?? '');

  // Extend mode state
  const [extendDays, setExtendDays] = useState<number>(30);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; message: string }
    | { kind: 'error'; code: string }
  >({ kind: 'idle' });

  const hasActiveOverride =
    !!props.manualPlanId &&
    (!props.manualPlanExpiresAt ||
      Date.parse(props.manualPlanExpiresAt) > Date.now());

  async function submit(payload: Record<string, unknown>) {
    setSubmitting(true);
    setResult({ kind: 'idle' });
    try {
      const res = await fetch(`/api/admin/orgs/${props.orgId}/plan-override`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setResult({ kind: 'error', code: json.error ?? `HTTP ${res.status}` });
      } else {
        setResult({ kind: 'success', message: `Action '${payload.action}' applied` });
        router.refresh();
      }
    } catch (err) {
      setResult({
        kind: 'error',
        code: err instanceof Error ? err.message : 'network_error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  function onGrant() {
    const payload: Record<string, unknown> = {
      action: 'grant',
      plan_id: planId,
      note: note.trim() || null,
    };
    if (days === null) {
      payload.permanent = true;
    } else {
      payload.days = days;
    }
    void submit(payload);
  }

  function onExtend() {
    void submit({ action: 'extend', days: extendDays });
  }

  function onRevoke() {
    if (!confirm(`Revoke the manual plan override for ${props.orgName}?`)) return;
    void submit({ action: 'revoke' });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
        Manual plan override
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Grant, extend, or revoke a comp without going through Stripe.
      </p>

      {/* Current state pill */}
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
        <p className="font-semibold text-slate-900 dark:text-slate-100">Current effective plan</p>
        <ul className="mt-2 space-y-1 text-slate-700 dark:text-slate-300">
          <li>
            Stripe-derived:{' '}
            <span className="font-mono text-xs">{props.currentPlanId ?? 'none'}</span>
          </li>
          <li>
            Manual override:{' '}
            {hasActiveOverride ? (
              <>
                <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">
                  {props.manualPlanId}
                </span>{' '}
                {props.manualPlanExpiresAt ? (
                  <span className="text-slate-500">
                    until {new Date(props.manualPlanExpiresAt).toLocaleString('en-US')}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    PERMANENT
                  </span>
                )}
              </>
            ) : (
              <span className="text-slate-500">none</span>
            )}
          </li>
          {props.manualPlanNote && (
            <li className="mt-2 text-xs italic text-slate-500">"{props.manualPlanNote}"</li>
          )}
        </ul>
      </div>

      {/* Tab strip */}
      <div className="mt-6 flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {(['grant', 'extend', 'revoke'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            disabled={submitting}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold capitalize transition ${
              mode === m
                ? 'border-emerald-600 text-emerald-700 dark:text-emerald-300'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Mode panels */}
      {mode === 'grant' && (
        <div className="mt-6 space-y-4">
          <FieldLabel label="Plan tier" required>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value as PlanId)}
              disabled={submitting}
              className={selectClass}
            >
              {PLAN_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </FieldLabel>

          <FieldLabel label="Duration" required>
            <select
              value={days === null ? 'permanent' : String(days)}
              onChange={(e) => {
                const v = e.target.value;
                setDays(v === 'permanent' ? null : Number(v));
              }}
              disabled={submitting}
              className={selectClass}
            >
              {DURATION_PRESETS.map((d) => (
                <option key={d.label} value={d.days === null ? 'permanent' : String(d.days)}>
                  {d.label}
                </option>
              ))}
            </select>
          </FieldLabel>

          <FieldLabel label="Note (internal — never shown to org)">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submitting}
              maxLength={1000}
              placeholder='e.g. "Founding 50 — DR launch" or "comp 60d soft-beta"'
              className={inputClass}
            />
          </FieldLabel>

          <button
            type="button"
            onClick={onGrant}
            disabled={submitting}
            className={primaryButton}
          >
            {submitting ? 'Granting…' : hasActiveOverride ? 'Replace override' : 'Grant override'}
          </button>
        </div>
      )}

      {mode === 'extend' && (
        <div className="mt-6 space-y-4">
          {!hasActiveOverride && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              No active override to extend. Use the Grant tab instead.
            </p>
          )}
          {props.manualPlanExpiresAt === null && hasActiveOverride && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              Active override is permanent (no expiration). Use Revoke + Grant
              to change to a timed override.
            </p>
          )}
          <FieldLabel label="Add days to expiration" required>
            <input
              type="number"
              min={1}
              max={3650}
              value={extendDays}
              onChange={(e) => setExtendDays(Math.max(1, Math.min(3650, Number(e.target.value) || 30)))}
              disabled={submitting}
              className={inputClass}
            />
          </FieldLabel>
          <button
            type="button"
            onClick={onExtend}
            disabled={submitting || !hasActiveOverride || props.manualPlanExpiresAt === null}
            className={primaryButton}
          >
            {submitting ? 'Extending…' : `Extend by ${extendDays} days`}
          </button>
        </div>
      )}

      {mode === 'revoke' && (
        <div className="mt-6 space-y-4">
          {!hasActiveOverride ? (
            <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
              No override to revoke.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Revoking will clear all manual_* fields. The org's effective
                plan falls back to the Stripe-derived plan ({' '}
                <span className="font-mono text-xs">{props.currentPlanId ?? 'none'}</span>)
                on the next plan check.
              </p>
              <button
                type="button"
                onClick={onRevoke}
                disabled={submitting}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? 'Revoking…' : 'Revoke override'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Result banner */}
      {result.kind === 'success' && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          ✓ {result.message}
        </p>
      )}
      {result.kind === 'error' && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
        >
          Error: {result.code}
        </p>
      )}
    </div>
  );
}

const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';
const selectClass = inputClass;
const primaryButton =
  'inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50';

function FieldLabel({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
        {label}
        {required && <span className="ml-1 text-emerald-600">*</span>}
      </span>
      {children}
    </label>
  );
}
