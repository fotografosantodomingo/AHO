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

interface OrgAnalyticsSummary {
  /** Total events in the window. */
  total: number;
  /** Per-event-type count: { property_view: 152, lead_form_submit: 8, ... }. */
  byType: Partial<Record<PropertyEventType, number>>;
  /** Distinct visitors (user_id OR anonymous_id) in the window. */
  uniqueVisitors: number;
  /** Conversion = leads / views (0..1; null if zero views). */
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
    return { total: 0, byType: {}, uniqueVisitors: 0, conversionRate: null };
  }

  type Row = { event_type: string; user_id: string | null; anonymous_id: string | null };
  const rows = (data ?? []) as Row[];

  const byType: Partial<Record<PropertyEventType, number>> = {};
  const visitorKeys = new Set<string>();
  for (const r of rows) {
    const t = r.event_type as PropertyEventType;
    byType[t] = (byType[t] ?? 0) + 1;
    const key = r.user_id ? `u:${r.user_id}` : r.anonymous_id ? `a:${r.anonymous_id}` : null;
    if (key) visitorKeys.add(key);
  }

  const views = byType.property_view ?? 0;
  const leads = byType.lead_form_submit ?? 0;
  const conversionRate = views > 0 ? leads / views : null;

  return {
    total: rows.length,
    byType,
    uniqueVisitors: visitorKeys.size,
    conversionRate,
  };
}

export interface TopListingRow {
  propertyId: string;
  shortId: string;
  title: string;
  city: string;
  status: string;
  views: number;
  leads: number;
  favorites: number;
  /** views / total visible-property-views in window (0..1). */
  shareOfViews: number;
}

/**
 * Top listings by view count for an org, with lead + favorite counts
 * for each. Filters out archived/sold/draft properties from the
 * ranking (analytics is for currently-active inventory).
 */
export async function getTopListingsByEngagement(
  supabase: SupabaseClient,
  orgId: string,
  since: Date,
  locale: 'en' | 'es',
  limit = 10,
): Promise<TopListingRow[]> {
  // 1. Pull events for the window.
  const { data: eventRows, error: eventErr } = await supabase
    .from('property_events')
    .select('property_id, event_type')
    .eq('org_id', orgId)
    .gte('created_at', since.toISOString())
    .limit(50000);
  if (eventErr) {
    console.warn('[analytics] top listings events fetch failed', eventErr);
    return [];
  }

  type EventRow = { property_id: string; event_type: string };
  const events = (eventRows ?? []) as EventRow[];

  // 2. Aggregate per property.
  type Agg = { views: number; leads: number; favorites: number };
  const byProperty = new Map<string, Agg>();
  for (const e of events) {
    const a = byProperty.get(e.property_id) ?? { views: 0, leads: 0, favorites: 0 };
    if (e.event_type === 'property_view') a.views += 1;
    else if (e.event_type === 'lead_form_submit') a.leads += 1;
    else if (e.event_type === 'favorite_add') a.favorites += 1;
    byProperty.set(e.property_id, a);
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
      return {
        propertyId: p.id,
        shortId: p.short_id,
        title,
        city: p.city,
        status: p.status,
        views: agg.views,
        leads: agg.leads,
        favorites: agg.favorites,
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
