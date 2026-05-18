import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side analytics queries for the dashboard AI tab
 * (`/dashboard/analytics?tab=ai`). Phase 2 of
 * `docs/AI_CONVERSION_PLAN.md`.
 *
 * Reads come from `ai_daily_stats` (migration 0072) — the
 * pre-aggregated daily rollup populated by the
 * `/api/cron/ai-daily-rollup` worker at 02:00 UTC. We always query the
 * org-level rows (`agent_id IS NULL`) for the dashboard since a single
 * org sees its own aggregate; per-agent breakdowns are reserved for the
 * future Agency-tier supervisor surface.
 *
 * RLS gating: the `org_members_read_ai_daily` policy already restricts
 * reads to the agent's own org via the user-context Supabase client,
 * so no service-role escape hatch is needed.
 *
 * Window: the dashboard surface reads a 30-day window in one round-trip
 * (~30 rows max for an org), then aggregates client-side into the
 * "this week" + "prior week" + "30-day" buckets.
 */

/** ISO 'YYYY-MM-DD' for a date N days ago (UTC). */
export function dayIsoNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Day-keyed row coming back from `ai_daily_stats` (org-level). */
export interface AiDailyRow {
  day: string; // 'YYYY-MM-DD'
  conversations: number;
  drafts_pending: number;
  drafts_approved: number;
  drafts_edited: number;
  drafts_auto_sent: number;
  drafts_rejected: number;
  escalations: number;
  leads_captured: number;
  viewings_booked: number;
  cost_usd_cents: number | null;
  channel_counts: Record<string, number>;
}

/**
 * Pull org-level rollup rows for the last `days` days. Rows that don't
 * exist in the table (days with no AI activity) are simply absent — the
 * caller treats them as zero in aggregates / charts.
 */
export async function getAiDailyStats(
  supabase: SupabaseClient,
  orgId: string,
  days = 30,
): Promise<AiDailyRow[]> {
  const since = dayIsoNDaysAgo(days);
  const { data, error } = await supabase
    .from('ai_daily_stats')
    .select(
      'day, conversations, drafts_pending, drafts_approved, drafts_edited, drafts_auto_sent, drafts_rejected, escalations, leads_captured, viewings_booked, cost_usd_cents, channel_counts',
    )
    .eq('org_id', orgId)
    .is('agent_id', null)
    .gte('day', since)
    .order('day', { ascending: false });
  if (error) {
    console.warn('[ai-analytics] daily stats fetch failed', {
      code: error.code,
      message: error.message,
    });
    return [];
  }
  return (data ?? []) as unknown as AiDailyRow[];
}

/**
 * Aggregate the raw daily rows into the headline metrics the AI tab
 * tiles render. Pure function — unit-testable without a Supabase mock.
 *
 * Weeks here are calendar-windowed by row.day (UTC), not by a 7×24h
 * sliding window — i.e. "this week" = the last 7 calendar days, "prior
 * week" = the 7 days before that.
 */
export interface AiHeadlineMetrics {
  /** Sum of conversations across the last 7 days. */
  conversationsThisWeek: number;
  /** Sum of conversations across the prior 7 days (days 8-14 ago). */
  conversationsPriorWeek: number;
  /**
   * Percent delta this-week vs prior-week. Null when prior was zero (no
   * meaningful denominator → render as "—" / "new this week" in UI).
   */
  conversationsDeltaPct: number | null;

  /** 30-day approval rate = (approved + edited) / (approved + edited + rejected). Null when denominator is zero. */
  approvalRate: number | null;
  /** 30-day edit rate = edited / (approved + edited). Null when denominator is zero. */
  editRate: number | null;
  /** 30-day lead capture rate = leads_captured / conversations. Null when conversations is zero. */
  leadCaptureRate: number | null;

  /** 30-day total conversations (denominator for capture / rate text). */
  totalConversations30d: number;
  /** 30-day total leads captured. */
  totalLeads30d: number;
  /** 30-day total viewings booked. */
  totalViewings30d: number;

  /** Time-saved estimate, minutes — 8 min × total 30-day conversations. */
  timeSavedMinutes30d: number;
}

export function aggregateHeadlineMetrics(
  rows: ReadonlyArray<AiDailyRow>,
): AiHeadlineMetrics {
  // Index by day for fast 7d-window slicing.
  const byDay = new Map<string, AiDailyRow>();
  for (const r of rows) byDay.set(r.day, r);

  // Build window keys: dayIsoNDaysAgo(1) is yesterday; "this week" =
  // days 1..7 ago; "prior week" = days 8..14 ago.
  const thisWeekDays: string[] = [];
  const priorWeekDays: string[] = [];
  for (let i = 1; i <= 7; i++) thisWeekDays.push(dayIsoNDaysAgo(i));
  for (let i = 8; i <= 14; i++) priorWeekDays.push(dayIsoNDaysAgo(i));

  let conversationsThisWeek = 0;
  let conversationsPriorWeek = 0;
  for (const d of thisWeekDays) conversationsThisWeek += byDay.get(d)?.conversations ?? 0;
  for (const d of priorWeekDays) conversationsPriorWeek += byDay.get(d)?.conversations ?? 0;

  const conversationsDeltaPct =
    conversationsPriorWeek > 0
      ? (conversationsThisWeek - conversationsPriorWeek) / conversationsPriorWeek
      : null;

  // 30-day totals — sum across all rows we got back (already filtered
  // by gte 30 days ago at the query layer).
  let approved = 0;
  let edited = 0;
  let rejected = 0;
  let conversations30d = 0;
  let leads30d = 0;
  let viewings30d = 0;
  for (const r of rows) {
    approved += r.drafts_approved;
    edited += r.drafts_edited;
    rejected += r.drafts_rejected;
    conversations30d += r.conversations;
    leads30d += r.leads_captured;
    viewings30d += r.viewings_booked;
  }

  const actioned = approved + edited + rejected;
  const approvalRate = actioned > 0 ? (approved + edited) / actioned : null;
  const approvalsTotal = approved + edited;
  const editRate = approvalsTotal > 0 ? edited / approvalsTotal : null;
  const leadCaptureRate = conversations30d > 0 ? leads30d / conversations30d : null;

  return {
    conversationsThisWeek,
    conversationsPriorWeek,
    conversationsDeltaPct,
    approvalRate,
    editRate,
    leadCaptureRate,
    totalConversations30d: conversations30d,
    totalLeads30d: leads30d,
    totalViewings30d: viewings30d,
    timeSavedMinutes30d: conversations30d * 8,
  };
}

/**
 * Daily trend rows for the conversations + leads chart. One entry per
 * day in the last 30 days, zero-filled for days with no activity so the
 * chart bars line up.
 */
export interface AiTrendPoint {
  day: string;
  conversations: number;
  leads: number;
}

export function buildTrend(rows: ReadonlyArray<AiDailyRow>, days = 30): AiTrendPoint[] {
  const byDay = new Map<string, AiDailyRow>();
  for (const r of rows) byDay.set(r.day, r);
  const out: AiTrendPoint[] = [];
  // Oldest → newest left-to-right for chart rendering.
  for (let i = days; i >= 1; i--) {
    const d = dayIsoNDaysAgo(i);
    const row = byDay.get(d);
    out.push({
      day: d,
      conversations: row?.conversations ?? 0,
      leads: row?.leads_captured ?? 0,
    });
  }
  return out;
}

/**
 * Top listings by AI conversation count over the last 30 days. Queries
 * `ai_conversations` joined with `properties`; groups client-side by
 * property_id; returns the top N with hydrated titles.
 *
 * RLS gating: `org_members_read_conv` policy restricts to the agent's
 * own org. We still pass `eq('org_id', orgId)` so the planner can use
 * the `idx_ai_conv_org` index instead of relying on the RLS subselect.
 */
export interface AiTopListingRow {
  propertyId: string;
  shortId: string;
  title: string;
  city: string;
  /** Slug appropriate for the current locale (en or es), with fallback. */
  slug: string | null;
  /** Number of distinct AI conversations on this listing in the window. */
  conversations: number;
}

export async function getTopAiListings(
  supabase: SupabaseClient,
  orgId: string,
  locale: string,
  days = 30,
  limit = 5,
): Promise<AiTopListingRow[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  const { data, error } = await supabase
    .from('ai_conversations')
    .select(
      `
      property_id,
      properties!inner ( id, short_id, title_en, title_es, slug_en, slug_es, city )
      `,
    )
    .eq('org_id', orgId)
    .not('property_id', 'is', null)
    .gte('first_message_at', since.toISOString())
    .limit(10000);

  if (error) {
    console.warn('[ai-analytics] top listings fetch failed', {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  type Row = {
    property_id: string;
    properties: {
      id: string;
      short_id: string;
      title_en: string | null;
      title_es: string | null;
      slug_en: string | null;
      slug_es: string | null;
      city: string;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  // Group + count + remember the first hydrated `properties` row we see
  // for that property_id (it's the same row across grouped entries).
  type Bucket = { count: number; prop: NonNullable<Row['properties']> };
  const byProperty = new Map<string, Bucket>();
  for (const r of rows) {
    if (!r.property_id || !r.properties) continue;
    const existing = byProperty.get(r.property_id);
    if (existing) {
      existing.count += 1;
    } else {
      byProperty.set(r.property_id, { count: 1, prop: r.properties });
    }
  }

  const sorted = Array.from(byProperty.values()).sort(
    (a, b) => b.count - a.count,
  );
  return sorted.slice(0, limit).map(({ count, prop }) => {
    const title =
      (locale === 'es' ? prop.title_es : prop.title_en) ??
      prop.title_en ??
      prop.title_es ??
      '—';
    const slug =
      (locale === 'es' ? prop.slug_es : prop.slug_en) ??
      prop.slug_en ??
      prop.slug_es ??
      null;
    return {
      propertyId: prop.id,
      shortId: prop.short_id,
      title,
      city: prop.city,
      slug,
      conversations: count,
    };
  });
}
