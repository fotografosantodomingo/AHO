'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LEAD_STATUSES, type LeadStatus } from '@/db/schema';
import { updateLeadStatus } from '@/lib/leads/actions';

interface Props {
  leadId: string;
  initialStatus: LeadStatus;
}

/**
 * Inline status changer for a lead row. Server Action call via useTransition;
 * router.refresh() pulls the updated row from the server (Server Component
 * page re-renders).
 *
 * Optimistic update via local state so the badge doesn't flicker through
 * "loading" on every change. On failure, snap back to the previous status
 * and surface the error.
 */
export function LeadStatusSelect({ leadId, initialStatus }: Props) {
  const t = useTranslations('dashboard.leads.leadStatus');
  const router = useRouter();
  const [status, setStatus] = useState<LeadStatus>(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as LeadStatus;
    const prev = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      const result = await updateLeadStatus(leadId, next);
      if (!result.ok) {
        setStatus(prev);
        setError(result.errorCode ?? 'failed');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={status}
        onChange={onChange}
        disabled={isPending}
        aria-label="Lead status"
        className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(s)}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
