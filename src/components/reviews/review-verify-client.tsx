'use client';

import { useEffect, useState } from 'react';

interface Labels {
  checking: string;
  success: string;
  expired: string;
  invalid: string;
}

interface Props {
  token: string;
  labels: Labels;
}

type VerifyState =
  | { kind: 'checking' }
  | { kind: 'success' }
  | { kind: 'expired' }
  | { kind: 'invalid' };

/**
 * Calls /api/reviews/verify on mount with the token from the URL.
 * Renders the resulting state. Idempotent on re-mount: a token that's
 * already been consumed returns the same 'expired' state.
 */
export function ReviewVerifyClient({ token, labels }: Props) {
  const [state, setState] = useState<VerifyState>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/reviews/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          errorCode?: string;
        };
        if (cancelled) return;
        if (data.ok) {
          setState({ kind: 'success' });
          return;
        }
        if (data.errorCode === 'invalid_or_expired') {
          setState({ kind: 'expired' });
        } else {
          setState({ kind: 'invalid' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'invalid' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (state.kind === 'checking') {
    return <p className="mt-6 text-helper">{labels.checking}</p>;
  }
  if (state.kind === 'success') {
    return (
      <div className="mt-6 rounded-card border border-border bg-surface p-4 text-sm shadow-whisper dark:bg-surface-deep">
        <p>{labels.success}</p>
      </div>
    );
  }
  if (state.kind === 'expired') {
    return (
      <div className="mt-6 rounded-card border border-amber-500/40 bg-amber-50 p-4 text-sm dark:border-amber-400/40 dark:bg-amber-950/30">
        <p>{labels.expired}</p>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-card border border-danger/40 bg-danger/5 p-4 text-sm">
      <p>{labels.invalid}</p>
    </div>
  );
}
