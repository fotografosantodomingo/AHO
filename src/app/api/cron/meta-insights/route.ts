import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import {
  fetchFacebookPostInsights,
  fetchInstagramMediaInsights,
  mapFacebookInsightsResponse,
  mapInstagramInsightsResponse,
  type ListingPostMetricInsert,
} from '@/lib/insights/meta';

export const runtime = 'edge';

/**
 * GET /api/cron/meta-insights
 *
 * Daily cron — Path A (Pages Function + external scheduler). The
 * external trigger (Cloudflare Worker on a CRON binding, GitHub Actions
 * scheduled workflow, or Upstash QStash — choice deferred to ops) hits
 * this URL once per day with `Authorization: Bearer ${CRON_SECRET}`.
 *
 * What it does:
 *   1. Loads every active `ad_platform_tokens` row for `platform = 'meta'`
 *      and decrypts the access token via `get_decrypted_access_token`.
 *   2. For each token, looks up the AHO-authored posts on that account
 *      (FB Page posts + IG media; both share the same Page token).
 *   3. Calls Graph `/insights` per post and per medium, maps the
 *      response into a `listing_post_metrics` upsert payload.
 *   4. Upserts via the unique partial index from migration 0038
 *      (listing_id, platform, post_external_id, date_trunc('day',
 *      captured_at)) so same-day reruns are idempotent.
 *
 * Today this writer is a STUB — Meta App Review hasn't approved live
 * publishing, so step (2) returns an empty list and the loop exits
 * after writing zero rows. The scaffolding below (auth guard, fetchers,
 * mappers, upsert path) is fully implemented and unit-tested so that
 * when App Review lands, the only diff to go live is replacing the
 * `findPostsForToken` body.
 *
 * Platform-name reality check (worth flagging — see DESIGN_REFERENCE
 * note below):
 *   - `ad_platform_tokens.platform` uses the SHORT name `'meta'`
 *     (per the CHECK constraint in 0036). One token row per (user,
 *     external_account) regardless of FB vs IG; the IG account hangs
 *     off the FB Page record at OAuth time.
 *   - `listing_post_metrics.platform` uses the SPECIFIC names
 *     `'facebook'` / `'instagram'` (per the CHECK in 0038). The mapper
 *     emits the right value per row.
 */

/**
 * Bearer-token guard. Pure-function so the unit test can exercise it
 * without spinning up a Next request.
 *
 * Returns `null` when the request is authorized; otherwise a
 * NextResponse with the 401 / 503 body the route should return.
 */
export function checkCronAuth(args: {
  authorizationHeader: string | null;
  expectedSecret: string | undefined;
}): { ok: true } | { ok: false; status: 401 | 503; errorCode: string } {
  if (!args.expectedSecret) {
    // Fail closed when the secret isn't configured server-side. 503
    // (not 500) so the scheduler retries instead of giving up.
    return { ok: false, status: 503, errorCode: 'cron_secret_unconfigured' };
  }
  const header = args.authorizationHeader ?? '';
  // Case-insensitive `Bearer ` prefix; trim trailing whitespace.
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) {
    return { ok: false, status: 401, errorCode: 'missing_bearer' };
  }
  const supplied = m[1]!.trim();
  // Constant-time compare — both strings get encoded to bytes of equal
  // length first. On mismatch we still iterate the full short length to
  // avoid timing leaks. (Edge runtime doesn't expose `crypto.timingSafeEqual`,
  // so we hand-roll.)
  if (supplied.length !== args.expectedSecret.length) {
    return { ok: false, status: 401, errorCode: 'bad_bearer' };
  }
  let mismatch = 0;
  for (let i = 0; i < supplied.length; i++) {
    mismatch |= supplied.charCodeAt(i) ^ args.expectedSecret.charCodeAt(i);
  }
  if (mismatch !== 0) {
    return { ok: false, status: 401, errorCode: 'bad_bearer' };
  }
  return { ok: true };
}

/** Shape of the Meta token rows we read from `ad_platform_tokens`. */
interface MetaTokenRow {
  id: string;
  user_id: string;
  external_account_id: string | null;
  display_name: string | null;
}

/**
 * Per-token list of (FB post + IG media) AHO has authored on this
 * account. Today this is a stub that returns `[]` because:
 *   - The `social_posts` table doesn't exist yet (deferred until Meta
 *     App Review approves live publishing — see CONTENT_HUB_VISION.md
 *     Sprint 2). Once it lands, this query joins
 *     `social_posts ⋈ properties` filtered by `external_account_id`
 *     and returns one entry per published post.
 *   - The dashboard renders the honest empty state via
 *     `aggregatePerformance([])` while this is true (per
 *     `lib/listings/listing-performance.ts`), so no user-visible
 *     downside to the stub.
 *
 * Exported for the (eventual) integration test that drives a fixture
 * `social_posts` row through the writer end-to-end.
 */
export async function findPostsForToken(
  _token: MetaTokenRow,
): Promise<
  ReadonlyArray<
    | { kind: 'facebook'; postId: string; listingId: string; postedAt: Date }
    | { kind: 'instagram'; mediaId: string; listingId: string; postedAt: Date }
  >
> {
  // Stub — see docblock. Returning [] keeps the writer correct + idle.
  return [];
}

/** Per-row outcome for the GET response — keeps the cron observable
 *  without needing a separate dashboard. */
interface PerTokenSummary {
  tokenId: string;
  externalAccountId: string | null;
  displayName: string | null;
  postsConsidered: number;
  rowsUpserted: number;
  errors: string[];
}

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
    // Same fail-closed pattern as the auth guard. Without the key, we
    // literally cannot decrypt access tokens, so fail loud.
    return NextResponse.json(
      { ok: false, errorCode: 'token_encryption_key_unconfigured' },
      { status: 503 },
    );
  }

  const supabase = createAdminClient();

  // 1. Pull active Meta tokens. `revoked_at IS NULL` mirrors the partial
  //    index `idx_ad_platform_tokens_platform_active` so this hits index.
  const { data: tokenRows, error: tokenErr } = await supabase
    .from('ad_platform_tokens')
    .select('id, user_id, external_account_id, display_name')
    .eq('platform', 'meta')
    .is('revoked_at', null);
  if (tokenErr) {
    console.warn('[cron/meta-insights] token fetch failed', tokenErr);
    return NextResponse.json(
      { ok: false, errorCode: 'token_fetch_failed' },
      { status: 500 },
    );
  }

  const summaries: PerTokenSummary[] = [];
  const tokens = (tokenRows ?? []) as MetaTokenRow[];

  for (const token of tokens) {
    const summary: PerTokenSummary = {
      tokenId: token.id,
      externalAccountId: token.external_account_id,
      displayName: token.display_name,
      postsConsidered: 0,
      rowsUpserted: 0,
      errors: [],
    };

    // 2. Decrypt the user's long-lived FB token. The IG-on-Graph endpoint
    //    accepts the same Page token so we don't need a second decrypt.
    //    NOTE: For full production the writer should call
    //    `/me/accounts` with the user token to derive the *Page* token
    //    per FB Page in scope, since post-level insights require the
    //    Page token (not the user token). Today's stub returns no posts,
    //    so we skip the page-token derivation. The TODO is logged here
    //    and tracked in OPEN_QUESTIONS once that flow is wired.
    const { data: accessToken, error: decryptErr } = await supabase.rpc(
      'get_decrypted_access_token',
      {
        p_user_id: token.user_id,
        p_platform: 'meta',
        p_external_account_id: token.external_account_id,
        p_key: env.AHO_TOKEN_ENCRYPTION_KEY,
      },
    );
    if (decryptErr || !accessToken || typeof accessToken !== 'string') {
      summary.errors.push(`decrypt_failed: ${decryptErr?.message ?? 'no_token'}`);
      summaries.push(summary);
      continue;
    }

    // 3. Resolve which posts to snapshot. Today: empty (stub).
    let posts: Awaited<ReturnType<typeof findPostsForToken>>;
    try {
      posts = await findPostsForToken(token);
    } catch (e) {
      summary.errors.push(
        `find_posts_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      summaries.push(summary);
      continue;
    }
    summary.postsConsidered = posts.length;

    // 4. Per-post snapshot.
    const inserts: ListingPostMetricInsert[] = [];
    for (const p of posts) {
      try {
        if (p.kind === 'facebook') {
          const raw = await fetchFacebookPostInsights({
            pageAccessToken: accessToken,
            postId: p.postId,
          });
          inserts.push(
            mapFacebookInsightsResponse({
              raw,
              listingId: p.listingId,
              postId: p.postId,
              postedAt: p.postedAt,
            }),
          );
        } else {
          const raw = await fetchInstagramMediaInsights({
            pageAccessToken: accessToken,
            mediaId: p.mediaId,
          });
          inserts.push(
            mapInstagramInsightsResponse({
              raw,
              listingId: p.listingId,
              mediaId: p.mediaId,
              postedAt: p.postedAt,
            }),
          );
        }
      } catch (e) {
        summary.errors.push(
          `${p.kind}_insights_failed: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    // 5. Idempotent insert. Migration 0038's unique index is on the
    //    EXPRESSION `(listing_id, platform, post_external_id, date_trunc('day', captured_at))`,
    //    which means `ON CONFLICT (listing_id, platform, post_external_id)`
    //    can't target it from a column list — PostgREST `.upsert()`
    //    needs an exact column-list match against a non-partial
    //    unique constraint, which we don't have. To stay idempotent
    //    within a UTC day without adding a migration, we:
    //      (a) delete this run's (listing, platform, post) rows whose
    //          captured_at is today (UTC), then
    //      (b) insert the fresh snapshots.
    //    The expression-based unique index still protects against
    //    accidental concurrent inserts; (a)+(b) just keeps a single
    //    cron run's retries from raising 23505. If two cron runs race
    //    on the same UTC day, the second hits the unique violation
    //    and we surface it in `summary.errors` — accepted because the
    //    external scheduler is configured single-flight.
    if (inserts.length > 0) {
      // Compute today's UTC start so the DELETE narrows to a single
      // calendar day per snapshot.
      const todayUtcStart = new Date();
      todayUtcStart.setUTCHours(0, 0, 0, 0);
      const todayUtcStartIso = todayUtcStart.toISOString();

      // (a) Delete this day's prior snapshots for the (listing, platform,
      //     post_external_id) tuples we're about to write.
      for (const r of inserts) {
        const { error: delErr } = await supabase
          .from('listing_post_metrics')
          .delete()
          .eq('listing_id', r.listingId)
          .eq('platform', r.platform)
          .eq('post_external_id', r.postExternalId)
          .gte('captured_at', todayUtcStartIso);
        if (delErr) {
          summary.errors.push(
            `dedupe_delete_failed[${r.platform}/${r.postExternalId}]: ${delErr.message}`,
          );
        }
      }

      // (b) Insert the fresh snapshots. Drizzle types use Date for
      //     timestamptz; supabase-js wants ISO strings — convert at the
      //     boundary so we don't widen the public type to `string | Date`.
      const rows = inserts.map((r) => ({
        listing_id: r.listingId,
        platform: r.platform,
        posted_at:
          r.postedAt instanceof Date ? r.postedAt.toISOString() : r.postedAt,
        post_external_id: r.postExternalId,
        reach: r.reach ?? 0,
        impressions: r.impressions ?? 0,
        clicks: r.clicks ?? 0,
        leads: r.leads ?? 0,
        cpl_cents: r.cplCents ?? null,
        currency: r.currency ?? 'USD',
      }));
      const { error: insertErr, count } = await supabase
        .from('listing_post_metrics')
        .insert(rows, { count: 'exact' });
      if (insertErr) {
        summary.errors.push(`insert_failed: ${insertErr.message}`);
      } else {
        summary.rowsUpserted = count ?? inserts.length;
      }
    }

    summaries.push(summary);
  }

  return NextResponse.json({
    ok: true,
    tokensProcessed: summaries.length,
    summaries,
  });
}
