'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Test-connection button for ConnectMetaSection. One per connected
 * account row (FB Page or IG Business). Calls POST
 * /api/social/connection-test which decrypts the stored token and
 * pings a benign Meta Graph endpoint to confirm the token still works.
 *
 * Phase G of docs/SOCIAL_AUTOMATION_PLAN.md + the skill
 * `social-platform-integration` step #8.
 *
 * Behavior:
 *   idle    → "Test" link
 *   testing → "Testing…" disabled link
 *   ok      → green "✓" + tooltip with platformName (resets after 5s)
 *   failed  → red "✗" + tooltip with errorCode (resets after 8s)
 */
export function TestConnectionButton({
  platform,
  externalAccountId,
}: {
  platform: 'meta' | 'linkedin';
  externalAccountId: string;
}) {
  const t = useTranslations('metaConnect');
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'testing' }
    | { kind: 'ok'; platformName: string | null }
    | { kind: 'failed'; errorCode: string; errorMessage: string }
  >({ kind: 'idle' });

  async function run() {
    setState({ kind: 'testing' });
    try {
      const res = await fetch('/api/social/connection-test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform, externalAccountId }),
      });
      const json = (await res.json()) as
        | { ok: true; platformName?: string | null }
        | { ok: false; errorCode: string; errorMessage?: string };
      if (!res.ok || !('ok' in json)) {
        setState({
          kind: 'failed',
          errorCode: `http_${res.status}`,
          errorMessage: 'Request failed',
        });
        return;
      }
      if (json.ok) {
        setState({ kind: 'ok', platformName: json.platformName ?? null });
        setTimeout(() => setState({ kind: 'idle' }), 5000);
      } else {
        setState({
          kind: 'failed',
          errorCode: json.errorCode,
          errorMessage: json.errorMessage ?? json.errorCode,
        });
        setTimeout(() => setState({ kind: 'idle' }), 8000);
      }
    } catch (err) {
      setState({
        kind: 'failed',
        errorCode: 'network',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setTimeout(() => setState({ kind: 'idle' }), 8000);
    }
  }

  if (state.kind === 'ok') {
    return (
      <span
        title={
          state.platformName
            ? `${t('testOk')} — ${state.platformName}`
            : t('testOk')
        }
        className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
      >
        ✓ {t('testOk')}
      </span>
    );
  }
  if (state.kind === 'failed') {
    return (
      <span
        title={`${state.errorCode}: ${state.errorMessage}`}
        className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300"
      >
        ✗ {state.errorCode}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={state.kind === 'testing'}
      className="text-xs text-helper underline-offset-2 hover:text-action hover:underline disabled:opacity-50 dark:hover:text-action-dark"
    >
      {state.kind === 'testing' ? t('testing') : t('test')}
    </button>
  );
}
