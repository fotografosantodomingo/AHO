'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateLeadStatus } from '@/lib/leads/actions';
import type { LeadStatus } from '@/db/schema';

interface Props {
  leadId: string;
  current: LeadStatus;
  target: LeadStatus;
  label: string;
  tone: 'emerald' | 'muted';
}

/**
 * One-click status mutation button used by the per-lead detail page's
 * "Quick actions" panel. Wraps the existing `updateLeadStatus` server
 * action so a single click on "Mark as won" / "Mark as lost" updates
 * without dropping into the dropdown. Disabled when the lead is already
 * in the target state.
 */
export function LeadQuickStatusButton({ leadId, current, target, label, tone }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isCurrent = current === target;

  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-300 text-emerald-900 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-200 dark:hover:bg-emerald-950/40'
      : 'border-border-strong text-helper hover:bg-black/5 dark:hover:bg-white/5';

  function onClick() {
    if (isCurrent || isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await updateLeadStatus(leadId, target);
      if (!result.ok) {
        setError(result.errorCode ?? 'failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={isCurrent || isPending}
        className={`inline-flex h-9 w-full items-center justify-center rounded-lg border px-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
      >
        {label}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
