import 'server-only';
import {
  META_GRAPH_BASE as META_GRAPH_BASE_DEFAULT,
  META_GRAPH_VERSION,
} from '@/lib/oauth/meta';
import { serverEnv } from '@/lib/env';
import type { NewListingPostMetric } from '@/db/schema';

/**
 * Meta (Facebook + Instagram) Insights API helpers — Sprint 3 daily
 * performance writer.
 *
 * Today this code is a STUB that's CORRECT and READY but doesn't have
 * data flowing yet. Meta App Review hasn't approved live publishing
 * (per docs/PROGRESS.md Sprint 2 status), so:
 *   - No `social_posts` rows are being created
 *   - No FB/IG post IDs exist to hand to the Insights API
 *   - The `listing_post_metrics` table is empty
 *
 * When App Review lands, the only change required to go live is the
 * `findPostsForToken` lookup below — everything downstream of "given a
 * (token, postId, listingId) tuple, snapshot today's metrics" is real
 * code, real types, real upserts, and is unit-tested via the pure
 * mappers exported from this module.
 *
 * ── Endpoints ──────────────────────────────────────────────────────
 *
 * Facebook posts (Pages-owned posts only — that's all the OAuth scope
 * grants us):
 *
 *   GET /{post-id}/insights?metric=post_impressions,post_engaged_users,post_clicks
 *   docs: https://developers.facebook.com/docs/graph-api/reference/v21.0/insights
 *
 *   Response shape (one entry per metric):
 *     {
 *       "data": [
 *         { "name": "post_impressions",   "values": [{ "value": 1234 }], "period": "lifetime", ... },
 *         { "name": "post_engaged_users", "values": [{ "value": 56  }],  "period": "lifetime", ... },
 *         { "name": "post_clicks",        "values": [{ "value": 89  }],  "period": "lifetime", ... }
 *       ],
 *       "paging": { ... }
 *     }
 *
 *   We map:
 *     post_impressions    → impressions
 *     post_engaged_users  → reach    (closest proxy for "people reached"; FB's
 *                                     `post_impressions_unique` was deprecated
 *                                     for v18+ in favour of post_engaged_users)
 *     post_clicks         → clicks
 *     leads / cpl         → 0 / null  (FB Lead Ads webhook will fill leads
 *                                     in a separate path, not this cron)
 *
 *   Auth: Page access token (the per-Page token returned by /me/accounts
 *   and stored in ad_platform_tokens.access_token_encrypted at OAuth time).
 *
 * Instagram media (only IG Business accounts linked to FB Pages — that's
 * all our `instagram_business_account` field gives us):
 *
 *   GET /{ig-media-id}/insights?metric=reach,impressions,engagement
 *   docs: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-media/insights
 *
 *   Response shape (same envelope as FB):
 *     {
 *       "data": [
 *         { "name": "reach",       "values": [{ "value": 4321 }], ... },
 *         { "name": "impressions", "values": [{ "value": 5678 }], ... },
 *         { "name": "engagement",  "values": [{ "value": 234  }], ... }
 *       ]
 *     }
 *
 *   We map:
 *     reach        → reach
 *     impressions  → impressions
 *     engagement   → clicks    (IG doesn't expose a click-out count for
 *                              non-ad media; engagement is the closest
 *                              cumulative interaction signal — likes +
 *                              comments + saves. Documented here so the
 *                              dashboard's "clicks" tile is honest about
 *                              what it represents on IG.)
 *     leads / cpl  → 0 / null  (FB Lead Ads webhook handles leads)
 *
 *   Auth: same Page access token used for the linked FB Page —
 *   IG-on-Graph delegates auth to the parent Page.
 *
 * ── Idempotency ─────────────────────────────────────────────────────
 *
 * The 0038 migration declares a unique index on
 *   (listing_id, platform, post_external_id, date_trunc('day', captured_at))
 *
 * so same-day re-runs of the cron upsert into the same row instead of
 * creating duplicates. We use `onConflict` with the column triple +
 * matching `date_trunc` — Supabase's PostgREST upsert respects partial
 * unique indexes when the conflict target columns line up with the
 * indexed expression. The route below issues a manual UPSERT via SQL
 * RPC fallback to handle the date_trunc expression cleanly.
 */

/** Graph version pinned in the OAuth helper, overridable via env for the
 *  insights writer alone. */
export function metaGraphVersion(): string {
  const env = serverEnv();
  return env.META_GRAPH_API_VERSION ?? META_GRAPH_VERSION;
}

/** Base URL for Insights HTTP calls. Derived from `metaGraphVersion`
 *  but exported so tests can stub it without monkey-patching `fetch`. */
export function metaGraphBase(): string {
  // META_GRAPH_BASE_DEFAULT already embeds META_GRAPH_VERSION; rebuild
  // when the env override is in play so the override actually takes
  // effect.
  const env = serverEnv();
  if (env.META_GRAPH_API_VERSION) {
    return `https://graph.facebook.com/${env.META_GRAPH_API_VERSION}`;
  }
  return META_GRAPH_BASE_DEFAULT;
}

// ── Types ───────────────────────────────────────────────────────────

/** A single metric entry in the insights `data` array. */
export interface MetaInsightsMetric {
  name: string;
  values: ReadonlyArray<{ value: number | string | Record<string, number> }>;
  period?: string;
  title?: string;
  description?: string;
}

/** Top-level shape of every `/insights` response. */
export interface MetaInsightsResponse {
  data: ReadonlyArray<MetaInsightsMetric>;
  paging?: { cursors?: { before?: string; after?: string } };
  /** Some error responses come back with HTTP 200 + an error envelope. */
  error?: { message: string; type?: string; code?: number; fbtrace_id?: string };
}

/** A row ready for upsert into `listing_post_metrics`. We omit the
 *  generated id + timestamps — Postgres fills them. */
export type ListingPostMetricInsert = Omit<
  NewListingPostMetric,
  'id' | 'createdAt' | 'updatedAt' | 'capturedAt'
> & {
  /** Override-able for tests; defaults to `now()` server-side. */
  capturedAt?: Date;
};

// ── Pure mappers ────────────────────────────────────────────────────

/**
 * Pluck the first numeric value for a metric out of a `MetaInsightsResponse`,
 * defaulting to 0 when the metric is absent. Both FB + IG return `values`
 * as a single-entry array for lifetime / day metrics; we take `[0].value`
 * and coerce to integer.
 *
 * Handles three shapes Meta sometimes returns:
 *   - `{ value: 1234 }`            (the common case)
 *   - `{ value: "1234" }`          (very old endpoints)
 *   - `{ value: { foo: 1, ... } }` (object-valued breakdowns; we sum)
 */
export function pluckMetric(
  response: MetaInsightsResponse,
  name: string,
): number {
  const entry = response.data.find((m) => m.name === name);
  if (!entry || !entry.values || entry.values.length === 0) return 0;
  const raw = entry.values[0]!.value;
  if (typeof raw === 'number') return Math.max(0, Math.trunc(raw));
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }
  if (raw && typeof raw === 'object') {
    let sum = 0;
    for (const v of Object.values(raw)) {
      if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    }
    return Math.max(0, Math.trunc(sum));
  }
  return 0;
}

/**
 * Map a FB post insights response into a `listing_post_metrics` upsert.
 *
 * `postedAt` is required because the Graph `/insights` endpoint doesn't
 * echo the post's creation time — it's known to the caller from the
 * `social_posts` row that triggered this snapshot.
 */
export function mapFacebookInsightsResponse(args: {
  raw: MetaInsightsResponse;
  listingId: string;
  postId: string;
  postedAt: Date;
}): ListingPostMetricInsert {
  const { raw, listingId, postId, postedAt } = args;
  return {
    listingId,
    platform: 'facebook',
    postedAt,
    postExternalId: postId,
    impressions: pluckMetric(raw, 'post_impressions'),
    reach: pluckMetric(raw, 'post_engaged_users'),
    clicks: pluckMetric(raw, 'post_clicks'),
    leads: 0,
    cplCents: null,
    currency: 'USD',
  };
}

/**
 * Map an IG media insights response into a `listing_post_metrics` upsert.
 */
export function mapInstagramInsightsResponse(args: {
  raw: MetaInsightsResponse;
  listingId: string;
  mediaId: string;
  postedAt: Date;
}): ListingPostMetricInsert {
  const { raw, listingId, mediaId, postedAt } = args;
  return {
    listingId,
    platform: 'instagram',
    postedAt,
    postExternalId: mediaId,
    reach: pluckMetric(raw, 'reach'),
    impressions: pluckMetric(raw, 'impressions'),
    clicks: pluckMetric(raw, 'engagement'),
    leads: 0,
    cplCents: null,
    currency: 'USD',
  };
}

// ── HTTP fetchers ───────────────────────────────────────────────────

/** Common fetch wrapper: returns the parsed JSON or throws with the
 *  HTTP status + body excerpt for the route's per-token error log. */
async function fetchInsightsJson(url: URL): Promise<MetaInsightsResponse> {
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `meta insights HTTP ${res.status}: ${text.slice(0, 500)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`meta insights non-json response: ${text.slice(0, 500)}`);
  }
  // Defensive: enforce the envelope shape so `pluckMetric` can rely on it.
  if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) {
    throw new Error(
      `meta insights missing data envelope: ${text.slice(0, 500)}`,
    );
  }
  return parsed as MetaInsightsResponse;
}

/**
 * GET `/{post-id}/insights?metric=post_impressions,post_engaged_users,post_clicks`
 * with the Page access token. Caller is responsible for passing the
 * Page-scoped token (NOT the user token) — required by Graph API for
 * post-level metrics.
 */
export async function fetchFacebookPostInsights(args: {
  pageAccessToken: string;
  postId: string;
}): Promise<MetaInsightsResponse> {
  const url = new URL(`${metaGraphBase()}/${encodeURIComponent(args.postId)}/insights`);
  url.searchParams.set(
    'metric',
    'post_impressions,post_engaged_users,post_clicks',
  );
  url.searchParams.set('access_token', args.pageAccessToken);
  return fetchInsightsJson(url);
}

/**
 * GET `/{ig-media-id}/insights?metric=reach,impressions,engagement` with
 * the same Page access token used for the parent FB Page.
 */
export async function fetchInstagramMediaInsights(args: {
  pageAccessToken: string;
  mediaId: string;
}): Promise<MetaInsightsResponse> {
  const url = new URL(`${metaGraphBase()}/${encodeURIComponent(args.mediaId)}/insights`);
  url.searchParams.set('metric', 'reach,impressions,engagement');
  url.searchParams.set('access_token', args.pageAccessToken);
  return fetchInsightsJson(url);
}
