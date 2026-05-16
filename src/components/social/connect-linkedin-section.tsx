import { getTranslations } from 'next-intl/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';

interface Props {
  locale: Locale;
  /** Optional flash payload from the OAuth callback's bounce. The
   *  social page parses ?linkedin_oauth=… and forwards the parsed values. */
  flash?: {
    status:
      | 'connected'
      | 'denied'
      | 'invalid'
      | 'state_mismatch'
      | 'exchange_failed'
      | 'fetch_failed'
      | null;
    name?: string;
    reason?: string;
  };
}

/**
 * Connected-LinkedIn UI section for /{locale}/dashboard/social.
 * Mirrors ConnectMetaSection but simpler: LinkedIn personal profile is
 * a single token per user (no pages, no sub-accounts). external_account_id
 * is the OIDC `sub` from /v2/userinfo; the publish primitive composes
 * urn:li:person:{sub} at call time.
 *
 * Per DECISIONS.md 2026-05-15: scope is w_member_social only. Company-page
 * publishing (Marketing Developer Platform / w_organization_social)
 * stays v1.1.
 */
export async function ConnectLinkedInSection({ locale, flash }: Props) {
  const t = await getTranslations({ locale, namespace: 'linkedinConnect' });
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;

  let token:
    | {
        id: string;
        external_account_id: string;
        display_name: string | null;
      }
    | null = null;
  if (userId) {
    const { data } = await supabase
      .from('ad_platform_tokens')
      .select('id, external_account_id, display_name')
      .eq('user_id', userId)
      .eq('platform', 'linkedin')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    token = data ?? null;
  }
  const connected = !!token;

  return (
    <section
      aria-labelledby="linkedin-connect-heading"
      className="space-y-4 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-helper">
            {t('eyebrow')}
          </p>
          <h2
            id="linkedin-connect-heading"
            className="mt-1 font-brand text-xl font-semibold tracking-tight md:text-[24px]"
          >
            {t('heading')}
          </h2>
        </div>
        {connected && (
          <span
            aria-label={t('statusConnected')}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {t('statusConnected')}
          </span>
        )}
      </header>

      {flash?.status === 'connected' && (
        <p
          role="status"
          className="rounded-card border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200"
        >
          {t('flashConnected', { name: flash.name ?? '—' })}
        </p>
      )}
      {flash?.status === 'denied' && (
        <p
          role="alert"
          className="rounded-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
        >
          {t('flashDenied')}
        </p>
      )}
      {flash?.status &&
        !['connected', 'denied'].includes(flash.status) && (
          <p
            role="alert"
            className="rounded-card border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-800 dark:text-red-200"
          >
            {t('flashError', { reason: flash.reason ?? flash.status })}
          </p>
        )}

      {!connected ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('explainerNotConnected')}
          </p>
          {/* Plain <a> — same-origin GET to an API route that 302s to
              linkedin.com. <Link> would prefetch and break OAuth. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/oauth/linkedin/start"
            className="btn-primary inline-flex h-10 items-center px-5"
          >
            {t('connectButton')}
          </a>
          <p className="text-xs text-helper">{t('scopesNote')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('explainerConnected', { name: token?.display_name ?? '—' })}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/oauth/linkedin/start"
              className="inline-flex h-9 items-center rounded-lg border border-border-strong bg-surface px-4 text-sm transition hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5"
            >
              {t('reconnectButton')}
            </a>
          </div>
        </div>
      )}
    </section>
  );
}
