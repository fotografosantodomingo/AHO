import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PropertyEventType } from '@/db/schema';

/**
 * Server-side analytics queries for the agent dashboard
 * (feat/property-analytics, sub-batch B).
 *
 * Read path goes through the user-context Supabase client so RLS
 * gates results to the agent's own org by default — no need for a
 * service-role escape hatch here. The `property_events_org_select`
 * policy (migration 0027) does the gating.
 *
 * Aggregation strategy: fetch raw events for the org + time window
 * (one network round-trip per query), aggregate in JS. For an org
 * with thousands of listings + tens of thousands of events per month,
 * this is fine on Edge runtime. If a particular org grows past
 * ~50k events/month we'll switch to SECURITY DEFINER PG aggregations.
 *
 * Window helpers: `daysAgo(7)` etc. return a Date — pass to the
 * `since` param.
 */

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Per-event-type Set of visitor keys. Pure-function helper output. */
export interface AggregatedVisitorBuckets {
  byType: Partial<Record<PropertyEventType, number>>;
  uniqueVisitors: number;
  viewingVisitors: number;
  leadingVisitors: number;
  conversionRate: number | null;
  total: number;
}

/**
 * Pure aggregator: takes a list of event rows (event_type + visitor
 * identity) and returns deduplicated visitor counts + per-event-type
 * counts + per-visitor conversion rate. Extracted from
 * `getOrgAnalytics` so the aggregation logic is unit-testable without
 * a Supabase mock.
 *
 * Visitor key: `u:{user_id}` if signed in, else `a:{anonymous_id}`.
 * Events without either are counted in `byType` but excluded from the
 * visitor sets (anonymous untrackable view).
 */
export function aggregateOrgEvents(
  rows: ReadonlyArray<{
    event_type: string;
    user_id: string | null;
    anonymous_id: string | null;
  }>,
): AggregatedVisitorBuckets {
  const byType: Partial<Record<PropertyEventType, number>> = {};
  const visitorKeys = new Set<string>();
  const viewingVisitorKeys = new Set<string>();
  const leadingVisitorKeys = new Set<string>();
  for (const r of rows) {
    const t = r.event_type as PropertyEventType;
    byType[t] = (byType[t] ?? 0) + 1;
    const key = r.user_id
      ? `u:${r.user_id}`
      : r.anonymous_id
        ? `a:${r.anonymous_id}`
        : null;
    if (key) {
      visitorKeys.add(key);
      if (t === 'property_view') viewingVisitorKeys.add(key);
      else if (t === 'lead_form_submit') leadingVisitorKeys.add(key);
    }
  }
  const conversionRate =
    viewingVisitorKeys.size > 0
      ? leadingVisitorKeys.size / viewingVisitorKeys.size
      : null;
  return {
    byType,
    uniqueVisitors: visitorKeys.size,
    viewingVisitors: viewingVisitorKeys.size,
    leadingVisitors: leadingVisitorKeys.size,
    conversionRate,
    total: rows.length,
  };
}

interface OrgAnalyticsSummary {
  /** Total events in the window. */
  total: number;
  /** Per-event-type count: { property_view: 152, lead_form_submit: 8, ... }. */
  byType: Partial<Record<PropertyEventType, number>>;
  /** Distinct visitors (user_id OR anonymous_id) in the window across all events. */
  uniqueVisitors: number;
  /** Distinct visitors who triggered ≥1 property_view in the window. */
  viewingVisitors: number;
  /** Distinct visitors who submitted ≥1 lead in the window. */
  leadingVisitors: number;
  /**
   * Conversion = visitors-who-leadgen / visitors-who-viewed (0..1; null
   * if zero visitors viewed). Per-VISITOR rate, not per-EVENT — a single
   * visitor with 10 views and 1 lead is 100%, not 10%.
   * Bug fixed 2026-05-06: previously computed `leads / views` from raw
   * event counts, which heavily under-reported real conversion.
   */
  conversionRate: number | null;
}

/**
 * Aggregate analytics for an org over a time window.
 */
export async function getOrgAnalytics(
  supabase: SupabaseClient,
  orgId: string,
  since: Date,
): Promise<OrgAnalyticsSummary> {
  const { data, error } = await supabase
    .from('property_events')
    .select('event_type, user_id, anonymous_id')
    .eq('org_id', orgId)
    .gte('created_at', since.toISOString())
    .limit(50000);
  if (error) {
    console.warn('[analytics] org summary fetch failed', error);
    return {
      total: 0,
      byType: {},
      uniqueVisitors: 0,
      viewingVisitors: 0,
      leadingVisitors: 0,
      conversionRate: null,
    };
  }

  type Row = { event_type: string; user_id: string | null; anonymous_id: string | null };
  return aggregateOrgEvents((data ?? []) as Row[]);
}

/**
 * Same shape as `getOrgAnalytics` but scoped to a single property. Used
 * by `/dashboard/analytics/[id]` (the per-listing drill-down page).
 *
 * RLS gating: the user-context client + `property_events_org_select`
 * policy already restricts events to the agent's own org. Adding
 * `property_id` as a filter narrows the rows further; if the agent
 * passes a property_id they can't see (different org), the query
 * returns zero rows and the page renders an empty state.
 */
export async function getPropertyAnalytics(
  supabase: SupabaseClient,
  propertyId: string,
  since: Date,
): Promise<OrgAnalyticsSummary> {
  const { data, error } = await supabase
    .from('property_events')
    .select('event_type, user_id, anonymous_id')
    .eq('property_id', propertyId)
    .gte('created_at', since.toISOString())
    .limit(50000);
  if (error) {
    console.warn('[analytics] property summary fetch failed', error);
    return {
      total: 0,
      byType: {},
      uniqueVisitors: 0,
      viewingVisitors: 0,
      leadingVisitors: 0,
      conversionRate: null,
    };
  }
  type Row = { event_type: string; user_id: string | null; anonymous_id: string | null };
  return aggregateOrgEvents((data ?? []) as Row[]);
}

export interface TopListingRow {
  propertyId: string;
  shortId: string;
  title: string;
  city: string;
  status: string;
  /** Total view events on this listing in the window. */
  views: number;
  /** Distinct visitors who viewed this listing (dedup via user_id OR anonymous_id). */
  uniqueViewers: number;
  /** Total lead-form submissions on this listing. */
  leads: number;
  /** Distinct visitors who submitted ≥1 lead on this listing. */
  uniqueLeaders: number;
  /** Total favorite-add events on this listing. */
  favorites: number;
  /**
   * Per-listing conversion = uniqueLeaders / uniqueViewers (0..1; null
   * if no visitors viewed). Per-VISITOR rate — see OrgAnalyticsSummary.
   */
  conversionRate: number | null;
  /** views / total visible-property-views in window (0..1). */
  shareOfViews: number;
}

/**
 * Top listings by view count for an org, with lead + favorite counts
 * + per-listing per-visitor conversion rate. Filters out archived /
 * sold / draft properties from the ranking (analytics is for
 * currently-active inventory).
 */
export async function getTopListingsByEngagement(
  supabase: SupabaseClient,
  orgId: string,
  since: Date,
  locale: 'en' | 'es',
  limit = 10,
): Promise<TopListingRow[]> {
  // 1. Pull events for the window. Include visitor identity so we can
  // dedup per-visitor counts (one viewer with 10 views is one
  // uniqueViewer, not ten).
  const { data: eventRows, error: eventErr } = await supabase
    .from('property_events')
    .select('property_id, event_type, user_id, anonymous_id')
    .eq('org_id', orgId)
    .gte('created_at', since.toISOString())
    .limit(50000);
  if (eventErr) {
    console.warn('[analytics] top listings events fetch failed', eventErr);
    return [];
  }

  type EventRow = {
    property_id: string;
    event_type: string;
    user_id: string | null;
    anonymous_id: string | null;
  };
  const events = (eventRows ?? []) as EventRow[];

  // 2. Aggregate per property: raw event counts + distinct-visitor
  // sets per event type (for dedupped conversion).
  type Agg = {
    views: number;
    leads: number;
    favorites: number;
    viewerKeys: Set<string>;
    leaderKeys: Set<string>;
  };
  const byProperty = new Map<string, Agg>();
  for (const e of events) {
    let a = byProperty.get(e.property_id);
    if (!a) {
      a = { views: 0, leads: 0, favorites: 0, viewerKeys: new Set(), leaderKeys: new Set() };
      byProperty.set(e.property_id, a);
    }
    const key = e.user_id ? `u:${e.user_id}` : e.anonymous_id ? `a:${e.anonymous_id}` : null;
    if (e.event_type === 'property_view') {
      a.views += 1;
      if (key) a.viewerKeys.add(key);
    } else if (e.event_type === 'lead_form_submit') {
      a.leads += 1;
      if (key) a.leaderKeys.add(key);
    } else if (e.event_type === 'favorite_add') {
      a.favorites += 1;
    }
  }
  if (byProperty.size === 0) return [];

  // 3. Sort by views desc, take top N.
  const sorted = Array.from(byProperty.entries()).sort(
    (a, b) => b[1].views - a[1].views,
  );
  const topIds = sorted.slice(0, limit).map(([id]) => id);

  // 4. Hydrate property titles.
  const { data: props, error: propsErr } = await supabase
    .from('properties')
    .select('id, short_id, title_en, title_es, city, status')
    .in('id', topIds);
  if (propsErr) {
    console.warn('[analytics] property hydrate failed', propsErr);
    return [];
  }

  const totalViews = events.filter((e) => e.event_type === 'property_view').length;

  type PropRow = {
    id: string;
    short_id: string;
    title_en: string | null;
    title_es: string | null;
    city: string;
    status: string;
  };
  const propMap = new Map<string, PropRow>(
    ((props ?? []) as PropRow[]).map((p) => [p.id, p]),
  );

  return topIds
    .map((id): TopListingRow | null => {
      const agg = byProperty.get(id);
      const p = propMap.get(id);
      if (!agg || !p) return null;
      const title =
        (locale === 'es' ? p.title_es : p.title_en) ??
        p.title_en ??
        p.title_es ??
        '—';
      const uniqueViewers = agg.viewerKeys.size;
      const uniqueLeaders = agg.leaderKeys.size;
      return {
        propertyId: p.id,
        shortId: p.short_id,
        title,
        city: p.city,
        status: p.status,
        views: agg.views,
        uniqueViewers,
        leads: agg.leads,
        uniqueLeaders,
        favorites: agg.favorites,
        conversionRate: uniqueViewers > 0 ? uniqueLeaders / uniqueViewers : null,
        shareOfViews: totalViews > 0 ? agg.views / totalViews : 0,
      };
    })
    .filter((row): row is TopListingRow => row !== null);
}

export interface ActivityRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  shortId: string;
  eventType: PropertyEventType;
  source: string | null;
  visitorType: 'auth' | 'anon';
  createdAt: string;
}

/**
 * Most-recent N events for a single property, with title joined.
 * Powers the activity feed on `/dashboard/analytics/[id]`.
 */
export async function getPropertyRecentActivity(
  supabase: SupabaseClient,
  propertyId: string,
  locale: 'en' | 'es',
  limit = 50,
): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('property_events')
    .select(
      `
      id, property_id, event_type, source, user_id, anonymous_id, created_at,
      property:properties!inner ( id, short_id, title_en, title_es )
      `,
    )
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[analytics] property activity fetch failed', error);
    return [];
  }
  type Row = {
    id: string;
    property_id: string;
    event_type: string;
    source: string | null;
    user_id: string | null;
    anonymous_id: string | null;
    created_at: string;
    property: {
      id: string;
      short_id: string;
      title_en: string | null;
      title_es: string | null;
    } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  return rows
    .filter((r) => !!r.property)
    .map((r): ActivityRow => {
      const p = r.property!;
      const title =
        (locale === 'es' ? p.title_es : p.title_en) ?? p.title_en ?? p.title_es ?? '—';
      return {
        id: r.id,
        propertyId: r.property_id,
        propertyTitle: title,
        shortId: p.short_id,
        eventType: r.event_type as PropertyEventType,
        source: r.source,
        visitorType: r.user_id ? 'auth' : 'anon',
        createdAt: r.created_at,
      };
    });
}

/**
 * Most-recent N events for an org, with property titles joined.
 */
export async function getRecentActivity(
  supabase: SupabaseClient,
  orgId: string,
  locale: 'en' | 'es',
  limit = 20,
): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('property_events')
    .select(
      `
      id, property_id, event_type, source, user_id, anonymous_id, created_at,
      property:properties!inner ( id, short_id, title_en, title_es )
      `,
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[analytics] activity fetch failed', error);
    return [];
  }

  type Row = {
    id: string;
    property_id: string;
    event_type: string;
    source: string | null;
    user_id: string | null;
    anonymous_id: string | null;
    created_at: string;
    property: {
      id: string;
      short_id: string;
      title_en: string | null;
      title_es: string | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Row[];
  return rows
    .filter((r) => !!r.property)
    .map((r): ActivityRow => {
      const p = r.property!;
      const title =
        (locale === 'es' ? p.title_es : p.title_en) ?? p.title_en ?? p.title_es ?? '—';
      return {
        id: r.id,
        propertyId: r.property_id,
        propertyTitle: title,
        shortId: p.short_id,
        eventType: r.event_type as PropertyEventType,
        source: r.source,
        visitorType: r.user_id ? 'auth' : 'anon',
        createdAt: r.created_at,
      };
    });
}
