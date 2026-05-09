import 'server-only';

/**
 * LinkedIn Marketing API insights — daily writer support layer.
 *
 * Stub-state today: AHO has not been approved for LinkedIn's Marketing
 * API live access (separate review process from Meta App Review per
 * docs/CONTENT_HUB_VISION.md Sprint 3). This module ships the integration
 * shape — pure mapping + HTTP fetch — so the cron lights up on the day
 * the app is approved without further code changes.
 *
 * Endpoints we target (LinkedIn versions every endpoint by month — pass
 * the version as the `LinkedIn-Version` header per the platform docs):
 *
 *   GET https://api.linkedin.com/rest/socialActions/{shareUrn}/socialMetadata
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/share-counts-api
 *
 * The `socialMetadata` endpoint returns the engagement counts for an
 * organic share (like / comment / share counts). For impression-level
 * insights on organic Page shares LinkedIn exposes a separate
 * `organizationalEntityShareStatistics` endpoint:
 *
 *   GET https://api.linkedin.com/rest/organizationalEntityShareStatistics
 *       ?q=organizationalEntity
 *       &organizationalEntity={orgUrn}
 *       &shares[0]={shareUrn}
 *
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/organizations/share-statistics
 *
 * The cron is expected to call BOTH (per-share metadata for like/comment
 * counts; per-share statistics for impressions / clicks / unique reach)
 * and merge into a single `listing_post_metrics` row. For the stub we
 * model the merged shape here, mock both responses in tests, and leave
 * the live wiring as a follow-up commit on the day approval lands.
 *
 * Required scopes on the access token:
 *   - r_organization_social
 *   - rw_organization_admin
 *   - r_member_social
 *
 * Rate limits: LinkedIn doesn't publish hard numbers, but documented
 * guidance is "no more than 100 requests/min per token". The cron
 * batches with a small delay to stay well under that.
 */

/** Pinned at runtime via env (`LINKEDIN_API_VERSION`). Format: `YYYYMM`.
 *  Exposed for tests. */
export const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';

/**
 * Subset of the `organizationalEntityShareStatistics` element shape we
 * read. Matches LinkedIn's documented schema; extra fields are ignored.
 *
 * Note that LinkedIn nests aggregate counters under `totalShareStatistics`.
 * `clickCount` here means link clicks; `impressionCount` is total
 * impressions; `uniqueImpressionsCount` maps to our `reach`.
 */
export interface LinkedInShareStatisticElement {
  totalShareStatistics: {
    clickCount?: number;
    commentCount?: number;
    engagement?: number;
    impressionCount?: number;
    likeCount?: number;
    shareCount?: number;
    uniqueImpressionsCount?: number;
  };
  share: string; // urn:li:share:1234567890
}

export interface LinkedInShareStatisticsResponse {
  elements: LinkedInShareStatisticElement[];
}

/**
 * The per-share `socialMetadata` shape. We don't currently store
 * comment / like counts in `listing_post_metrics`, but we keep the
 * response surface here so future schema additions slot in without
 * a second pass.
 */
export interface LinkedInSocialMetadataResponse {
  shareUrn: string;
  commentsState: string;
  reactionsSummary?: {
    aggregatedTotalReactions?: number;
  };
  commentSummary?: {
    aggregatedTotalComments?: number;
  };
}

/**
 * Input to the pure mapper: the merged statistics for one share +
 * the listing it maps to + when the post originally went live + the
 * snapshot timestamp the cron passes in. The mapping is intentionally
 * conservative — anything LinkedIn doesn't return falls back to 0
 * (matching the SQL CHECK constraints `>= 0`).
 */
export interface LinkedInMetricMapInput {
  listingId: string;
  shareUrn: string;
  postedAt: string; // ISO8601, when the share went live on LinkedIn
  capturedAt: string; // ISO8601, the cron's snapshot timestamp
  statistics: LinkedInShareStatisticElement | null;
}

/**
 * Output shape mirrors the `listing_post_metrics` insert row (snake_case
 * column names). `cpl_cents` is null in the organic-only writer; paid-
 * spend attribution is a separate pipeline (LinkedIn Ads campaigns →
 * we'd hit `adAnalyticsV2` instead). `currency` defaults to USD per the
 * SQL default; future paid pipeline overrides this per campaign.
 */
export interface ListingPostMetricInsertRow {
  listing_id: string;
  platform: 'linkedin';
  posted_at: string;
  post_external_id: string;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl_cents: number | null;
  currency: 'USD';
  captured_at: string;
}

/**
 * Pure mapper — no I/O. Unit-tested directly against frozen example
 * responses. Defensive defaults: when LinkedIn returns a share with
 * no `totalShareStatistics` (happens for shares <2h old), we still
 * write a zero-row so the dashboard's time series has a continuous
 * data point; the next day's run picks up the real numbers.
 */
export function mapLinkedInResponseToMetric(
  input: LinkedInMetricMapInput,
): ListingPostMetricInsertRow {
  const stats = input.statistics?.totalShareStatistics ?? {};
  const reach = Math.max(0, Math.floor(stats.uniqueImpressionsCount ?? 0));
  const impressions = Math.max(0, Math.floor(stats.impressionCount ?? 0));
  const clicks = Math.max(0, Math.floor(stats.clickCount ?? 0));
  return {
    listing_id: input.listingId,
    platform: 'linkedin',
    posted_at: input.postedAt,
    post_external_id: input.shareUrn,
    reach,
    impressions,
    clicks,
    // Lead attribution comes from LinkedIn Lead Gen Forms via a separate
    // webhook pipeline (mirrors the FB Lead Ads webhook). Organic shares
    // can't book leads directly; we leave the counter at 0 and let the
    // webhook increment when forms come in.
    leads: 0,
    // Organic-only writer — no spend attached. Paid-spend rows come
    // from the `adAnalyticsV2` pipeline (separate writer, not in scope).
    cpl_cents: null,
    currency: 'USD',
    captured_at: input.capturedAt,
  };
}

/**
 * HTTP wrapper around the share-statistics endpoint. Returns the
 * matching element from the response array, or null when LinkedIn
 * returns no element for the requested share (happens when the share
 * was deleted between scheduling and the cron run).
 *
 * Stubbed today: with no production LinkedIn token, every call would
 * 401. The cron handles the null/error path gracefully so the rest of
 * the loop continues across remaining tokens. When approval lands,
 * this function works as-is.
 */
export async function fetchLinkedInShareStatistics(args: {
  accessToken: string;
  apiVersion: string;
  organizationUrn: string;
  shareUrn: string;
  fetchImpl?: typeof fetch;
}): Promise<LinkedInShareStatisticElement | null> {
  const fetcher = args.fetchImpl ?? fetch;
  const url = new URL(`${LINKEDIN_API_BASE}/organizationalEntityShareStatistics`);
  url.searchParams.set('q', 'organizationalEntity');
  url.searchParams.set('organizationalEntity', args.organizationUrn);
  url.searchParams.set('shares[0]', args.shareUrn);
  const res = await fetcher(url.toString(), {
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'LinkedIn-Version': args.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });
  if (!res.ok) {
    // Caller logs and continues — one bad token shouldn't break the
    // loop across all connected agents.
    return null;
  }
  const json = (await res.json()) as LinkedInShareStatisticsResponse;
  return (
    json.elements?.find((e) => e.share === args.shareUrn) ??
    json.elements?.[0] ??
    null
  );
}
