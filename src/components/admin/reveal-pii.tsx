'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  /** Lead id — addresses the reveal endpoint. */
  leadId: string;
  /** Which field to reveal. */
  field: 'email' | 'phone';
  /** Server-rendered masked text — shown until the admin clicks reveal. */
  masked: string;
}

/**
 * Click-to-reveal wrapper for one PII field on the admin/leads list
 * (QA report 2026-05-10 P1 #21). The masked text renders server-side;
 * this client component swaps it for the unmasked value after a
 * successful POST to /api/admin/leads/[id]/reveal, which writes an
 * audit_log row keyed on the calling admin's id.
 *
 * UX choices:
 *   - The button is small and visually quiet — admins shouldn't feel
 *     "punished" for a routine reveal, but the audit log makes it
 *     accountable. Compare with #21's "every admin reads everything"
 *     concern.
 *   - On error, surface the error message inline (don't silently
 *     leave the field masked — that reads as "your click was
 *     ignored").
 *   - Once revealed in the page lifetime, we keep the value visible
 *     (no auto-hide). The admin chose to look; re-masking would be
 *     theatre.
 */
export function RevealPii({ leadId, field, masked }: Props) {
  const t = useTranslations('adminLeads');
  const [state, setState] = useState<'masked' | 'revealing' | 'revealed' | 'error'>(
    'masked',
  );
  const [value, setValue] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (state === 'revealed' && value) {
    return <span>{value}</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs">{masked}</span>
      <button
        type="button"
        disabled={state === 'revealing'}
        onClick={async () => {
          setState('revealing');
          setErrorMsg(null);
          try {
            const res = await fetch(`/api/admin/leads/${leadId}/reveal`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ field }),
            });
            const json = (await res.json().catch(() => null)) as
              | { ok: true; value: string }
              | { ok: false; errorCode: string }
              | null;
            if (!res.ok || !json || !('value' in json)) {
              setErrorMsg(
                (json && 'errorCode' in json && json.errorCode) || `HTTP ${res.status}`,
              );
              setState('error');
              return;
            }
            setValue(json.value);
            setState('revealed');
          } catch (e) {
            setErrorMsg(e instanceof Error ? e.message : String(e));
            setState('error');
          }
        }}
        className="inline-flex h-5 items-center rounded-md border border-border-strong/40 px-1.5 text-[10px] font-medium text-helper transition hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/5"
        aria-label={
          field === 'email' ? t('revealEmailAria') : t('revealPhoneAria')
        }
      >
        {state === 'revealing' ? t('revealing') : t('reveal')}
      </button>
      {state === 'error' && errorMsg && (
        <span role="alert" className="text-[10px] text-red-600">
          {errorMsg}
        </span>
      )}
    </span>
  );
}
