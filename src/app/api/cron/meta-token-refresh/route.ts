import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { META_GRAPH_BASE, exchangeForLongLived } from '@/lib/oauth/meta';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';

export const runtime = 'edge';

/**
 * GET /api/cron/meta-token-refresh
 *
 * Phase G of docs/SOCIAL_AUTOMATION_PLAN.md — daily cron that keeps
 * long-lived Meta user-access tokens fresh.
 *
 * Per Meta's docs:
 *   - Long-lived user access tokens expire after ~60 days
 *   - Page access tokens derived from a long-lived user token DO NOT
 *     EXPIRE — so we only need to refresh the user-level rows
 *   - The exchange endpoint takes the existing long-lived token + the
 *     app id/secret and returns a new long-lived token with a fresh
 *     60-day expiry. Idempotent if called repeatedly.
 *
 * Schedule: once per day. External scheduler (Cloudflare cron trigger
 * via wrangler.toml, or cron-job.org) hits this URL with
 * `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Targeting policy:
 *   - platform='meta' AND revoked_at IS NULL
 *   - external_account_id NOT LIKE 'page:%' AND NOT LIKE 'ig:%'
 *     (user-level rows only; pages don't expire)
 *   - expires_at IS NOT NULL AND expires_at < now() + 7 days
 *     (refresh within 7 days of expiry; gives ample buffer before
 *      publish failures start)
 *
 * Output: per-token JSON summary. Always 200 when auth passes; per-token
 * errors recorded in the response so the cron operator can see them.
 *
 * Bearer-token auth via shared `checkCronAuth` helper from meta-insights.
 */

interface UserTokenRow {
  id: string;
  user_id: string;
  external_account_id: string;
  display_name: string | null;
  expires_at: string | null;
  scopes: string[] | null;
}

interface PerTokenSummary {
  tokenId: string;
  externalAccountId: string;
  status: 'refreshed' | 'skipped' | 'failed';
  oldExpiresAt: string | null;
  newExpiresAt?: string | null;
  errorCode?: string;
  errorMessage?: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const env = serverEnv();
  const guard = checkCronAuth({
    authorizationHeader: req.headers.get('authorization'),
    expectedSecret: env.CRON_SECRET,
  });
  if (!guard.ok) {
    return NextResponse.json(
      { ok: false, errorCode: guard.errorCode },
      { status: guard.status },
    );
  }

  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { ok: false, errorCode: 'token_encryption_key_unconfigured' },
      { status: 503 },
    );
  }
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return NextResponse.json(
      { ok: false, errorCode: 'meta_app_credentials_unconfigured' },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const sevenDaysFromNow = new Date(Date.now() + SEVEN_DAYS_MS).toISOString();

  // Find user-level Meta tokens approaching expiry.
  const { data: tokenRows, error: tokenErr } = await admin
    .from('ad_platform_tokens')
    .select('id, user_id, external_account_id, display_name, expires_at, scopes')
    .eq('platform', 'meta')
    .is('revoked_at', null)
    .not('external_account_id', 'like', 'page:%')
    .not('external_account_id', 'like', 'ig:%')
    .not('expires_at', 'is', null)
    .lt('expires_at', sevenDaysFromNow);

  if (tokenErr) {
    console.warn('[cron/meta-token-refresh] token fetch failed', tokenErr);
    return NextResponse.json(
      { ok: false, errorCode: 'token_fetch_failed', details: tokenErr.message },
      { status: 500 },
    );
  }

  const rows: UserTokenRow[] = tokenRows ?? [];
  const summaries: PerTokenSummary[] = [];

  for (const row of rows) {
    const { data: plainToken, error: decryptErr } = await admin.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: row.user_id,
        p_platform: 'meta',
        p_external_account_id: row.external_account_id,
        p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
      },
    );
    if (decryptErr || !plainToken) {
      summaries.push({
        tokenId: row.id,
        externalAccountId: row.external_account_id,
        status: 'failed',
        oldExpiresAt: row.expires_at,
        errorCode: 'decrypt_failed',
        errorMessage: decryptErr?.message ?? 'null plaintext',
      });
      continue;
    }

    // Exchange existing long-lived token for a fresh one. Meta
    // idempotently returns a new ~60d token even if the input still
    // has time left.
    let exchanged;
    try {
      exchanged = await exchangeForLongLived({
        appId: env.META_APP_ID,
        appSecret: env.META_APP_SECRET,
        shortToken: plainToken as string,
      });
    } catch (e) {
      console.warn(
        '[cron/meta-token-refresh] exchange failed',
        row.external_account_id,
        e,
      );
      summaries.push({
        tokenId: row.id,
        externalAccountId: row.external_account_id,
        status: 'failed',
        oldExpiresAt: row.expires_at,
        errorCode: 'exchange_failed',
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const newExpiresAt =
      exchanged.expires_in != null
        ? new Date(Date.now() + exchanged.expires_in * 1000).toISOString()
        : null;

    // Upsert the refreshed token via the existing SECURITY DEFINER RPC.
    // Preserves the (user_id, platform, external_account_id) row.
    const { error: upsertErr } = await admin.rpc('upsert_platform_token', {
      p_user_id: row.user_id,
      p_platform: 'meta',
      p_external_account_id: row.external_account_id,
      p_display_name: row.display_name,
      p_access_token: exchanged.access_token,
      p_refresh_token: null,
      p_expires_at: newExpiresAt,
      // Preserve the scopes that were granted at OAuth time. The RPC's
      // `do update set scopes = excluded.scopes` would otherwise blow
      // them away if we passed an empty array.
      p_scopes: row.scopes ?? [],
      p_user_agent: null,
      p_ip_address: null,
      p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
    });
    if (upsertErr) {
      summaries.push({
        tokenId: row.id,
        externalAccountId: row.external_account_id,
        status: 'failed',
        oldExpiresAt: row.expires_at,
        errorCode: 'upsert_failed',
        errorMessage: upsertErr.message,
      });
      continue;
    }

    summaries.push({
      tokenId: row.id,
      externalAccountId: row.external_account_id,
      status: 'refreshed',
      oldExpiresAt: row.expires_at,
      newExpiresAt,
    });
  }

  const refreshed = summaries.filter((s) => s.status === 'refreshed').length;
  const failed = summaries.filter((s) => s.status === 'failed').length;
  return NextResponse.json({
    ok: true,
    scanned: rows.length,
    refreshed,
    failed,
    summaries,
    // Defensive — surface the META_GRAPH_BASE so a misconfigured graph
    // version is obvious from one curl call.
    metaGraphBase: META_GRAPH_BASE,
  });
}
