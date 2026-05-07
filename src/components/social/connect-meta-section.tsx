import { getTranslations } from 'next-intl/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Locale } from '@/i18n/config';

interface Props {
  locale: Locale;
  /** Optional flash payload from the OAuth callback's bounce. The
   *  social page parses ?meta_oauth=… and forwards the parsed values. */
  flash?: {
    status: 'connected' | 'denied' | 'invalid' | 'state_mismatch' | 'exchange_failed' | 'long_lived_failed' | 'fetch_failed' | null;
    pages?: number;
    ig?: number;
    reason?: string;
  };
}

/**
 * Connected-accounts UI for the Pro Automation tier on
 * /{locale}/dashboard/social. Shows the Connect Facebook button when
 * no tokens are stored, or a per-account list when at least one
 * connection exists. Disconnect uses the user-context client + the
 * `ad_tokens_owner_revoke` UPDATE policy on migration 0036.
 *
 * Day 3 of the execution plan, phase 2. The button bounces to
 * /api/oauth/meta/start which redirects to Facebook's dialog; the
 * callback writes encrypted tokens and bounces back here with a
 * `?meta_oauth=…` flash.
 */
export async function ConnectMetaSection({ locale, flash }: Props) {
  const t = await getTranslations({ locale, namespace: 'metaConnect' });
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;

  // List meta tokens for this user. RLS owner_select gates this so we
  // get our own rows (or nothing for anon — but the dashboard layout
  // already requires auth, so userId is always set).
  let tokens:
    | Array<{
        id: string;
        external_account_id: string;
        display_name: string | null;
        scopes: string[];
        revoked_at: string | null;
      }>
    | null = null;
  if (userId) {
    const { data } = await supabase
      .from('ad_platform_tokens')
      .select('id, external_account_id, display_name, scopes, revoked_at')
      .eq('user_id', userId)
      .eq('platform', 'meta')
      .is('revoked_at', null)
      .order('created_at', { ascending: true });
    tokens = data ?? [];
  }

  const userToken = tokens?.find((t) => !t.external_account_id.startsWith('page:') && !t.external_account_id.startsWith('ig:'));
  const pageTokens = tokens?.filter((t) => t.external_account_id.startsWith('page:')) ?? [];
  const igTokens = tokens?.filter((t) => t.external_account_id.startsWith('ig:')) ?? [];
  const connected = !!userToken;

  return (
    <section
      aria-labelledby="meta-connect-heading"
      className="space-y-4 rounded-card border border-border bg-surface p-6 shadow-whisper dark:bg-surface-deep"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-helper">
            {t('eyebrow')}
          </p>
          <h2
            id="meta-connect-heading"
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
          {t('flashConnected', {
            pages: flash.pages ?? 0,
            ig: flash.ig ?? 0,
          })}
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
            {t('flashError', { reason: flash.status })}
          </p>
        )}

      {!connected ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('explainerNotConnected')}
          </p>
          {/* Plain <a> on purpose: this is a same-origin GET to an
              API route (browser must follow the 302 to facebook.com),
              not a navigation to a Next.js page. <Link> would
              prefetch and break the OAuth flow. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/api/oauth/meta/start"
            className="btn-primary inline-flex h-10 items-center px-5"
          >
            {t('connectButton')}
          </a>
          <p className="text-xs text-helper">{t('scopesNote')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('explainerConnected', { name: userToken?.display_name ?? '—' })}
          </p>

          {pageTokens.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                {t('facebookPagesHeading', { count: pageTokens.length })}
              </p>
              <ul className="mt-2 space-y-1.5">
                {pageTokens.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
                  >
                    <span aria-hidden="true">📘</span>
                    <span className="font-medium text-ink">{p.display_name ?? p.external_account_id}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {igTokens.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-helper">
                {t('instagramAccountsHeading', { count: igTokens.length })}
              </p>
              <ul className="mt-2 space-y-1.5">
                {igTokens.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 text-sm text-ink-muted dark:text-ink-inverse-muted"
                  >
                    <span aria-hidden="true">📷</span>
                    <span className="font-medium text-ink">{p.display_name ?? p.external_account_id}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pageTokens.length === 0 && (
            <p className="rounded-card border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              {t('noPagesHint')}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/oauth/meta/start"
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
