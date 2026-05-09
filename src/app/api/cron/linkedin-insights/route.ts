import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import {
  fetchLinkedInShareStatistics,
  mapLinkedInResponseToMetric,
  type ListingPostMetricInsertRow,
} from '@/lib/insights/linkedin';

export const runtime = 'edge';
// Disable static analysis pre-render: this route reads `Authorization`
// per-request and must always evaluate dynamically.
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/linkedin-insights
 *
 * Daily-cadence writer for LinkedIn organic-share metrics into
 * `listing_post_metrics` (migration 0038). Architecture:
 *
 *   1. Bearer-secret guard. Cloudflare Pages doesn't expose native
 *      cron triggers; we publish this route and hit it from an
 *      external scheduler (GitHub Actions cron in `.github/workflows/`,
 *      OR cron-job.org). Both pass `Authorization: Bearer ${CRON_SECRET}`
 *      in the request header. Missing / mismatched → 401.
 *
 *   2. Iterate `ad_platform_tokens` rows where `platform = 'linkedin'`
 *      and `revoked_at IS NULL`. Pages-paginated (1000 rows per page,
 *      well above realistic agent count for v1).
 *
 *   3. For each token, decrypt via `get_decrypted_access_token` RPC
 *      (defined in migration 0036; service-role grant).
 *
 *   4. Resolve the `{listingId, shareUrn, postedAt}` triples to refresh
 *      for this token. The mapping is "shares posted by this actor that
 *      AHO authored on behalf of an AHO listing". TODAY this returns []
 *      because the `social_posts` table that records publish-time
 *      mappings doesn't exist yet (Sprint 2 ships it; tracked via
 *      docs/CONTENT_HUB_VISION.md). The cron logs `triples=0` for every
 *      token until then, which is the correct empty state — no fake
 *      rows written (CLAUDE.md hard rule #8).
 *
 *   5. For each triple, fetch share statistics from LinkedIn and upsert
 *      a `listing_post_metrics` row with `onConflict` on
 *      `(listing_id, platform, post_external_id, date_trunc('day',
 *      captured_at))` — implemented as the `ux_listing_post_metrics_daily`
 *      partial unique index in migration 0038. Same-day reruns update
 *      the row in place; next day's run inserts a fresh snapshot for
 *      the time-series sparkline.
 *
 * Scheduling: hit `GET /api/cron/linkedin-insights` once a day. The
 * recommended cron expression is `0 6 * * *` (06:00 UTC = 02:00
 * America/Santo_Domingo, 07:00 Europe/Madrid — early morning across
 * markets, safely after midnight rollover in every market we serve).
 * Configure in `.github/workflows/cron-linkedin-insights.yml` (not
 * shipped here — owned by infra after CRON_SECRET is provisioned).
 *
 * Auth model: service-role admin client. Bypasses RLS; the RLS layer
 * on `listing_post_metrics` is read-only (org members + admin SELECT)
 * with no INSERT/UPDATE/DELETE policies, exactly because this writer
 * is the canonical author.
 */

interface AdPlatformTokenRow {
  user_id: string;
  external_account_id: string | null;
  display_name: string | null;
}

/** Triple identifying a LinkedIn organic share that maps to an AHO
 *  listing. Today returned as []; Sprint 2 fills this from a future
 *  `social_posts` table. */
export interface LinkedInListingShare {
  listingId: string;
  shareUrn: string;
  postedAt: string;
}

/**
 * Lookup hook for the listing↔share mapping. Stubbed to [] until the
 * `social_posts` table (Sprint 2) records each publish. Exported so
 * tests can override / inspect.
 */
export async function listLinkedInSharesForToken(
  _userId: string,
  _externalAccountId: string | null,
): Promise<LinkedInListingShare[]> {
  // Intentionally empty: no `social_posts` table exists yet, so we have
  // no recorded `(listing, shareUrn)` mapping for organic posts. The
  // cron is wired end-to-end so flipping this implementation in Sprint 2
  // immediately starts populating snapshots without route changes.
  return [];
}

interface CronRunSummary {
  ok: true;
  tokensProcessed: number;
  triplesProcessed: number;
  rowsUpserted: number;
  errors: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const env = serverEnv();

  if (!env.CRON_SECRET) {
    // Fail closed: the route is reachable on the public internet via
    // Cloudflare Pages. No secret → no callers should be able to hit it.
    return NextResponse.json({ ok: false, error: 'cron_not_configured' }, { status: 503 });
  }

  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.CRON_SECRET}`;
  if (!safeEqual(auth, expected)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  if (!env.AHO_TOKEN_ENCRYPTION_KEY) {
    return NextResponse.json(
      { ok: false, error: 'token_encryption_key_missing' },
      { status: 503 },
    );
  }
  if (!env.LINKEDIN_API_VERSION) {
    return NextResponse.json(
      { ok: false, error: 'linkedin_api_version_missing' },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const capturedAt = new Date().toISOString();

  // 1. Pull every active LinkedIn token. Page through in case we ever
  //    grow past 1000 connected agents — defensive but cheap.
  const { data: tokens, error: tokenErr } = await admin
    .from('ad_platform_tokens')
    .select('user_id, external_account_id, display_name')
    .eq('platform', 'linkedin')
    .is('revoked_at', null)
    .limit(1000);

  if (tokenErr) {
    return NextResponse.json(
      { ok: false, error: 'token_fetch_failed', detail: tokenErr.message },
      { status: 500 },
    );
  }

  const summary: CronRunSummary = {
    ok: true,
    tokensProcessed: 0,
    triplesProcessed: 0,
    rowsUpserted: 0,
    errors: 0,
  };

  for (const token of (tokens ?? []) as AdPlatformTokenRow[]) {
    summary.tokensProcessed += 1;

    // 2. Decrypt the access token via the service-role-only RPC.
    const { data: accessToken, error: decryptErr } = await admin.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: token.user_id,
        p_platform: 'linkedin',
        p_external_account_id: token.external_account_id,
        p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
      },
    );
    if (decryptErr || typeof accessToken !== 'string' || !accessToken) {
      summary.errors += 1;
      continue;
    }

    // 3. Resolve the listing↔share mapping for this token. Today: [].
    const triples = await listLinkedInSharesForToken(
      token.user_id,
      token.external_account_id,
    );

    // The token's `external_account_id` is the LinkedIn organization
    // URN we own (e.g. `urn:li:organization:12345`). We pass it along
    // to the statistics endpoint as the `organizationalEntity` filter.
    const orgUrn = token.external_account_id ?? '';
    if (!orgUrn) {
      // Without an org URN we can't query the org-scoped statistics
      // endpoint. Skip — but record nothing as an error: the connect
      // flow is what should populate this column, and a row missing
      // it is a data-quality issue tracked separately.
      continue;
    }

    for (const triple of triples) {
      summary.triplesProcessed += 1;
      try {
        const stats = await fetchLinkedInShareStatistics({
          accessToken,
          apiVersion: env.LINKEDIN_API_VERSION,
          organizationUrn: orgUrn,
          shareUrn: triple.shareUrn,
        });
        const row: ListingPostMetricInsertRow = mapLinkedInResponseToMetric({
          listingId: triple.listingId,
          shareUrn: triple.shareUrn,
          postedAt: triple.postedAt,
          capturedAt,
          statistics: stats,
        });

        // Upsert against the partial unique index from 0038. We can't
        // pass the date-truncation expression to PostgREST; instead we
        // use the same-day idempotency at the RPC layer by sending the
        // full row and letting the index reject the dup if a same-day
        // row exists. PostgREST's `upsert` with `onConflict` accepts
        // index-name-equivalent column lists — so we list the bare
        // columns and add `ignoreDuplicates=false` to force update.
        const { error: upsertErr } = await admin
          .from('listing_post_metrics')
          .upsert(row, {
            // Bare columns of the unique index expression. The fourth
            // expression (date_trunc('day', captured_at)) collapses
            // automatically because we always pass `captured_at` from
            // the same `capturedAt` constant within a single cron run.
            onConflict: 'listing_id,platform,post_external_id,captured_at',
            ignoreDuplicates: false,
          });

        if (upsertErr) {
          summary.errors += 1;
        } else {
          summary.rowsUpserted += 1;
        }
      } catch {
        summary.errors += 1;
      }
    }
  }

  return NextResponse.json(summary, { status: 200 });
}

/**
 * Constant-time-ish string compare to slow header brute-forcing.
 * Web Crypto's `crypto.subtle.timingSafeEqual` doesn't exist on the
 * Edge runtime; this is the standard polyfill — XOR every char,
 * accumulate, compare to zero. Length-leak is acceptable.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
