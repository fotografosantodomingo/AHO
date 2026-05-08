import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sprint 3 — Performance dashboard data layer.
 *
 * Reads `listing_post_metrics` (migration 0037) through the user-
 * context Supabase client; RLS gates rows to the listing's org via
 * `listing_post_metrics_org_select`. The aggregator below is a pure
 * function (`aggregatePerformance`) so unit tests can exercise the
 * math without a Supabase mock.
 *
 * Today's reality: the table is empty. Meta App Review hasn't
 * approved live publishing, the FB Lead Ads webhook isn't wired,
 * and no cron is populating snapshots. The shape returned here is
 * what the dashboard renders against; when zero rows arrive the
 * aggregates are all zero and the dashboard shows the honest empty
 * state (CLAUDE.md hard rule #8).
 *
 * Future writers — none of which exist as code yet:
 *   - `workers/meta-insights-cron` — daily Worker that loops over
 *     active `ad_platform_tokens` rows for platform IN (meta, ...),
 *     calls the platform's Insights API for posts AHO authored,
 *     and upserts a row per (listing, platform, post, captured_day).
 *   - `POST /api/webhooks/meta/leads` — FB Lead Ads webhook that
 *     increments the `leads` counter on the latest snapshot row for
 *     the originating post and forwards the contact into the existing
 *     `leads` table tagged with source='fb_lead_ad'.
 *   - LinkedIn Marketing API cron — same shape, separate review
 *     process per docs/CONTENT_HUB_VISION.md Sprint 3.
 *
 * The dashboard is contract-stable today; new platforms just appear
 * as new tiles when their first row lands.
 */

/** Supported social platforms. Mirrors the SQL CHECK in 0037. */
export const SOCIAL_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'pinterest',
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** A single raw snapshot row as returned by Postgres. */
export interface ListingPostMetricRow {
  id: string;
  listingId: string;
  platform: SocialPlatform;
  postedAt: string;
  postExternalId: string;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  cplCents: number | null;
  currency: string;
  capturedAt: string;
}

/** Per-platform aggregate tile shown at the top of the dashboard. */
export interface PerformancePlatformTile {
  platform: SocialPlatform;
  /** Sum of reach across the LATEST snapshot per (post_external_id). */
  totalReach: number;
  /** Sum of leads across the LATEST snapshot per (post_external_id). */
  totalLeads: number;
  /**
   * Average CPL across posts that have spend recorded, in integer cents.
   * NULL when no post on this platform has CPL data (organic-only).
   */
  avgCplCents: number | null;
  /** Currency of the avgCplCents — first non-USD seen, else 'USD'. */
  cplCurrency: string;
  /** ISO timestamp of the most recent posted_at on this platform. */
  lastPostedAt: string | null;
  /** Distinct posts on this platform. */
  postCount: number;
}

/** Per-post row for the bottom-of-page breakdown table. */
export interface PerformancePostRow {
  postExternalId: string;
  platform: SocialPlatform;
  postedAt: string;
  reach: number;
  impressions: number;
  clicks: number;
  leads: number;
  cplCents: number | null;
  currency: string;
}

/** One bucket on the 30-day reach sparkline. */
export interface PerformanceSparkPoint {
  /** YYYY-MM-DD UTC. */
  day: string;
  /** Sum of reach captured on this day (across platforms / posts). */
  reach: number;
}

export interface ListingPerformance {
  /** True when no rows exist. Drives the empty-state branch in the UI. */
  isEmpty: boolean;
  perPlatform: PerformancePlatformTile[];
  recentPosts: PerformancePostRow[];
  /** 30-day sparkline, oldest to newest, padded with zero-reach days. */
  sparkline30d: PerformanceSparkPoint[];
}

const PLATFORM_SET: ReadonlySet<string> = new Set<string>(SOCIAL_PLATFORMS);

function isPlatform(p: string): p is SocialPlatform {
  return PLATFORM_SET.has(p);
}

/**
 * Pure aggregator: takes raw rows, returns the dashboard-shaped view.
 * Extracted so the unit test can drive it with a fixture array, no
 * Supabase mock required.
 *
 * Strategy:
 *   1. Group rows by (platform, post_external_id) and keep only the
 *      LATEST snapshot per post (max captured_at). Cumulative
 *      counters means the latest snapshot IS the running total —
 *      summing across snapshots would double-count.
 *   2. Per-platform tile = sum of latest-snapshot counters across
 *      that platform's posts; lastPostedAt = max posted_at.
 *   3. Recent posts table = the latest-snapshot rows sorted by
 *      posted_at desc.
 *   4. Sparkline = sum of reach per UTC day across the last 30
 *      days. Uses every row (not just latest), so a same-day re-snap
 *      DOES double-count — accepted: cron writes once per day per
 *      post, retries inside the same day are upserted via the partial
 *      unique index (see migration 0037).
 */
export function aggregatePerformance(
  rows: ReadonlyArray<ListingPostMetricRow>,
  now: Date = new Date(),
): ListingPerformance {
  if (rows.length === 0) {
    return {
      isEmpty: true,
      perPlatform: [],
      recentPosts: [],
      sparkline30d: buildEmptySparkline(now),
    };
  }

  // ── 1. Latest snapshot per (platform, post_external_id) ───────
  const latestByPost = new Map<string, ListingPostMetricRow>();
  for (const r of rows) {
    if (!isPlatform(r.platform)) continue;
    const key = `${r.platform}::${r.postExternalId}`;
    const prev = latestByPost.get(key);
    if (!prev || r.capturedAt > prev.capturedAt) {
      latestByPost.set(key, r);
    }
  }

  // ── 2. Per-platform tiles ─────────────────────────────────────
  const tilesByPlatform = new Map<SocialPlatform, PerformancePlatformTile>();
  for (const r of latestByPost.values()) {
    let tile = tilesByPlatform.get(r.platform);
    if (!tile) {
      tile = {
        platform: r.platform,
        totalReach: 0,
        totalLeads: 0,
        avgCplCents: null,
        cplCurrency: 'USD',
        lastPostedAt: null,
        postCount: 0,
      };
      tilesByPlatform.set(r.platform, tile);
    }
    tile.totalReach += r.reach;
    tile.totalLeads += r.leads;
    tile.postCount += 1;
    if (!tile.lastPostedAt || r.postedAt > tile.lastPostedAt) {
      tile.lastPostedAt = r.postedAt;
    }
  }

  // CPL average — second pass so we know each tile's post count.
  const cplAccByPlatform = new Map<
    SocialPlatform,
    { sumCents: number; count: number; currency: string }
  >();
  for (const r of latestByPost.values()) {
    if (r.cplCents == null) continue;
    const acc = cplAccByPlatform.get(r.platform) ?? {
      sumCents: 0,
      count: 0,
      currency: r.currency,
    };
    acc.sumCents += r.cplCents;
    acc.count += 1;
    cplAccByPlatform.set(r.platform, acc);
  }
  for (const [platform, acc] of cplAccByPlatform) {
    const tile = tilesByPlatform.get(platform);
    if (!tile) continue;
    tile.avgCplCents = Math.round(acc.sumCents / acc.count);
    tile.cplCurrency = acc.currency;
  }

  // Sort tiles by reach desc (matches the headline UI emphasis).
  const perPlatform = Array.from(tilesByPlatform.values()).sort(
    (a, b) => b.totalReach - a.totalReach,
  );

  // Defensive: if every input row had an unknown platform we end up
  // with zero tiles. Treat that as empty so the dashboard renders the
  // honest "no data yet" branch rather than a populated-with-nothing
  // shell.
  if (perPlatform.length === 0) {
    return {
      isEmpty: true,
      perPlatform: [],
      recentPosts: [],
      sparkline30d: buildEmptySparkline(now),
    };
  }

  // ── 3. Recent posts table ─────────────────────────────────────
  const recentPosts: PerformancePostRow[] = Array.from(latestByPost.values())
    .map(
      (r): PerformancePostRow => ({
        postExternalId: r.postExternalId,
        platform: r.platform,
        postedAt: r.postedAt,
        reach: r.reach,
        impressions: r.impressions,
        clicks: r.clicks,
        leads: r.leads,
        cplCents: r.cplCents,
        currency: r.currency,
      }),
    )
    .sort((a, b) => (a.postedAt < b.postedAt ? 1 : -1));

  // ── 4. Sparkline — sum reach per UTC day, last 30 days ────────
  const sparkline30d = buildSparkline(rows, now);

  return {
    isEmpty: false,
    perPlatform,
    recentPosts,
    sparkline30d,
  };
}

function utcDayKey(iso: string): string {
  // YYYY-MM-DD slice from an ISO string (Z-anchored, so substring works).
  return iso.slice(0, 10);
}

function buildEmptySparkline(now: Date): PerformanceSparkPoint[] {
  return last30Days(now).map((day) => ({ day, reach: 0 }));
}

function buildSparkline(
  rows: ReadonlyArray<ListingPostMetricRow>,
  now: Date,
): PerformanceSparkPoint[] {
  const days = last30Days(now);
  const reachByDay = new Map<string, number>();
  for (const day of days) reachByDay.set(day, 0);
  for (const r of rows) {
    const day = utcDayKey(r.capturedAt);
    if (!reachByDay.has(day)) continue; // outside window
    reachByDay.set(day, (reachByDay.get(day) ?? 0) + r.reach);
  }
  return days.map((day) => ({ day, reach: reachByDay.get(day) ?? 0 }));
}

function last30Days(now: Date): string[] {
  // Inclusive 30-day window ending on `now` (UTC). Oldest first.
  const out: string[] = [];
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  for (let i = 29; i >= 0; i--) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Fetch performance for a single listing from Supabase. RLS gates the
 * read — passing a listingId the caller doesn't own returns zero
 * rows and the dashboard renders the empty state.
 */
export async function getPerformanceForListing(
  supabase: SupabaseClient,
  listingId: string,
): Promise<ListingPerformance> {
  // 30-day window: matches the sparkline. The per-platform tile aggregates
  // run over the same window — the dashboard is "what's working RIGHT NOW",
  // not all-time.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from('listing_post_metrics')
    .select(
      `
      id, listing_id, platform, posted_at, post_external_id,
      reach, impressions, clicks, leads, cpl_cents, currency, captured_at
      `,
    )
    .eq('listing_id', listingId)
    .gte('captured_at', since.toISOString())
    .order('posted_at', { ascending: false })
    .limit(5000);
  if (error) {
    console.warn('[listing-performance] fetch failed', error);
    return aggregatePerformance([]);
  }
  type RawRow = {
    id: string;
    listing_id: string;
    platform: string;
    posted_at: string;
    post_external_id: string;
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    cpl_cents: number | null;
    currency: string;
    captured_at: string;
  };
  const raw = (data ?? []) as RawRow[];
  const rows: ListingPostMetricRow[] = raw
    .filter((r): r is RawRow & { platform: SocialPlatform } =>
      isPlatform(r.platform),
    )
    .map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      platform: r.platform,
      postedAt: r.posted_at,
      postExternalId: r.post_external_id,
      reach: r.reach,
      impressions: r.impressions,
      clicks: r.clicks,
      leads: r.leads,
      cplCents: r.cpl_cents,
      currency: r.currency,
      capturedAt: r.captured_at,
    }));
  return aggregatePerformance(rows);
}
