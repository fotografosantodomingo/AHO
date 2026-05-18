import 'server-only';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/analytics/stat-tile';
import {
  aggregateHeadlineMetrics,
  buildTrend,
  getAiDailyStats,
  getTopAiListings,
  type AiTrendPoint,
} from '@/lib/analytics/ai-queries';

/**
 * `/dashboard/analytics?tab=ai` — AI Conversion tab.
 *
 * Phase 2 of `docs/AI_CONVERSION_PLAN.md`. Reads from `ai_daily_stats`
 * (the org-level rollup rows; agent_id IS NULL) plus `ai_conversations`
 * (for the top-listings table). RLS gates everything to the agent's
 * own org via the user-context Supabase client.
 *
 * Empty state when the org has zero rollup rows — honest emptiness per
 * CLAUDE.md hard rule #8.
 *
 * Note on v1 vs v2:
 *   - Intent mix donut + risk flag stacked bar are deferred to v2; the
 *     rollup cron leaves `intent_counts` + `risk_flag_counts` empty in
 *     v1, so rendering them would always be empty/misleading.
 *   - `cost_usd_cents` is also NULL in v1 (rollup doesn't join
 *     `ai_generation_log` yet). The "time saved" tile uses the
 *     conversation-count estimate per the plan.
 */
export async function AiAnalyticsTab({
  orgId,
  locale,
}: {
  orgId: string;
  locale: Locale;
}) {
  const t = await getTranslations({ locale, namespace: 'analytics.ai' });

  const supabase = await createServerSupabaseClient();
  const [rows, topListings] = await Promise.all([
    getAiDailyStats(supabase, orgId, 30),
    getTopAiListings(supabase, orgId, locale, 30, 5),
  ]);

  if (rows.length === 0) {
    return (
      <EmptyState
        heading={t('emptyHeading')}
        body={t('emptyBody')}
        primaryCta={
          <Link
            href={localePath(locale, '/dashboard/properties')}
            className="btn-primary"
          >
            {t('emptyCta')}
          </Link>
        }
      />
    );
  }

  const metrics = aggregateHeadlineMetrics(rows);
  const trend = buildTrend(rows, 30);

  const approvalRate =
    metrics.approvalRate != null
      ? `${(metrics.approvalRate * 100).toFixed(0)}%`
      : '—';
  const editRate =
    metrics.editRate != null
      ? `${(metrics.editRate * 100).toFixed(0)}%`
      : '—';
  const leadCaptureRate =
    metrics.leadCaptureRate != null
      ? `${(metrics.leadCaptureRate * 100).toFixed(1)}%`
      : '—';

  const deltaCaption =
    metrics.conversationsDeltaPct == null
      ? t('conversationsDeltaNew')
      : formatDeltaPct(metrics.conversationsDeltaPct, locale);

  const timeSaved = formatHoursMinutes(metrics.timeSavedMinutes30d, locale);

  return (
    <div className="space-y-8">
      {/* Headline tiles — 5 metrics for the AI surface. */}
      <section
        aria-label={t('statsAria')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        <StatTile
          label={t('conversationsTitle')}
          primary={metrics.conversationsThisWeek}
          secondary={null}
          secondaryLabel={deltaCaption}
        />
        <StatTile
          label={t('approvalRateTitle')}
          primary={approvalRate}
          secondary={null}
          secondaryLabel={t('approvalRateCaption')}
        />
        <StatTile
          label={t('editRateTitle')}
          primary={editRate}
          secondary={null}
          secondaryLabel={t('editRateCaption')}
        />
        <StatTile
          label={t('leadCaptureRateTitle')}
          primary={leadCaptureRate}
          secondary={null}
          secondaryLabel={t('leadCaptureRateCaption')}
        />
        <StatTile
          label={t('timeSavedTitle')}
          primary={timeSaved}
          secondary={null}
          secondaryLabel={t('timeSavedCaption')}
        />
      </section>

      {/* Trend chart — conversations + leads, daily, last 30 days. */}
      <section aria-labelledby="ai-trend-heading" className="space-y-3">
        <h2
          id="ai-trend-heading"
          className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
        >
          {t('trendTitle')}
        </h2>
        <AiTrendChart
          points={trend}
          conversationsLabel={t('trendLegendConversations')}
          leadsLabel={t('trendLegendLeads')}
          srLabel={t('trendSrLabel')}
        />
      </section>

      {/* TODO: populate intent_counts in the rollup cron; render donut here. */}
      {/* TODO: populate risk_flag_counts in the rollup cron; render stacked bar here. */}

      {/* Top-performing listings (by AI conversation count). */}
      {topListings.length > 0 && (
        <section aria-labelledby="ai-top-listings-heading" className="space-y-3">
          <h2
            id="ai-top-listings-heading"
            className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
          >
            {t('topListingsTitle')}
          </h2>
          <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-whisper">
            <table className="min-w-full text-sm">
              <thead className="border-b border-border text-left">
                <tr>
                  <th className="px-3 py-2 font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper">
                    {t('colListing')}
                  </th>
                  <th className="hidden px-3 py-2 font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper md:table-cell">
                    {t('colCity')}
                  </th>
                  <th className="px-3 py-2 text-right font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper">
                    {t('colConversations')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {topListings.map((row) => {
                  const drillSegment =
                    locale === 'es'
                      ? 'panel/estadisticas'
                      : 'dashboard/analytics';
                  const drillHref = `/${locale}/${drillSegment}/${row.propertyId}`;
                  return (
                    <tr
                      key={row.propertyId}
                      className="transition hover:bg-surface-warm/40 dark:hover:bg-surface-dark/40"
                    >
                      <td className="max-w-[280px] truncate px-3 py-2 font-medium">
                        <Link
                          href={drillHref}
                          className="hover:text-action dark:hover:text-action-dark"
                        >
                          {row.title}
                          <span className="ml-2 text-xs text-helper">
                            {row.shortId}
                          </span>
                        </Link>
                      </td>
                      <td className="hidden px-3 py-2 text-helper md:table-cell">
                        {row.city}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.conversations}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Plain-SVG dual-series bar chart for the AI conversion trend. Bars
 * for conversations + leads, one bar pair per day, last 30 days.
 *
 * Same approach as `SparklineCard` in `social-performance-section.tsx`:
 * no chart-library dependency, scales to container via SVG viewBox.
 */
function AiTrendChart({
  points,
  conversationsLabel,
  leadsLabel,
  srLabel,
}: {
  points: AiTrendPoint[];
  conversationsLabel: string;
  leadsLabel: string;
  srLabel: string;
}) {
  const width = 720;
  const height = 140;
  const padX = 12;
  const padY = 12;
  const labelGutter = 18; // bottom gutter for axis tick labels

  const maxValue = Math.max(
    1,
    ...points.flatMap((p) => [p.conversations, p.leads]),
  );

  const innerW = width - padX * 2;
  const innerH = height - padY * 2 - labelGutter;
  const slotW = points.length > 0 ? innerW / points.length : 0;
  const barGroupGap = 2;
  const barW = Math.max(1, (slotW - barGroupGap) / 2);

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-whisper">
      <div className="flex items-center gap-4 text-xs text-helper">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-action" />
          {conversationsLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-action/40" />
          {leadsLabel}
        </span>
      </div>
      <svg
        role="img"
        aria-label={srLabel}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="mt-3 block h-36 text-action"
      >
        {/* Baseline */}
        <line
          x1={padX}
          y1={height - padY - labelGutter}
          x2={width - padX}
          y2={height - padY - labelGutter}
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="1"
        />
        {points.map((p, i) => {
          const groupX = padX + i * slotW;
          const convH = (p.conversations / maxValue) * innerH;
          const leadH = (p.leads / maxValue) * innerH;
          const baseY = height - padY - labelGutter;
          return (
            <g key={p.day}>
              <rect
                x={groupX}
                y={baseY - convH}
                width={barW}
                height={convH}
                fill="currentColor"
                fillOpacity="0.85"
                rx="1"
              />
              <rect
                x={groupX + barW + barGroupGap}
                y={baseY - leadH}
                width={barW}
                height={leadH}
                fill="currentColor"
                fillOpacity="0.35"
                rx="1"
              />
            </g>
          );
        })}
        {/* Sparse axis ticks: first, middle, last. */}
        {points.length > 0 && (
          <>
            <text
              x={padX}
              y={height - 4}
              fontSize="10"
              fill="currentColor"
              fillOpacity="0.5"
            >
              {formatDayShort(points[0]!.day)}
            </text>
            <text
              x={width / 2}
              y={height - 4}
              fontSize="10"
              textAnchor="middle"
              fill="currentColor"
              fillOpacity="0.5"
            >
              {formatDayShort(points[Math.floor(points.length / 2)]!.day)}
            </text>
            <text
              x={width - padX}
              y={height - 4}
              fontSize="10"
              textAnchor="end"
              fill="currentColor"
              fillOpacity="0.5"
            >
              {formatDayShort(points[points.length - 1]!.day)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}

// ── format helpers ─────────────────────────────────────────────────

/** 'YYYY-MM-DD' → 'May 3' style short label. */
function formatDayShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

function formatDeltaPct(pct: number, locale: string): string {
  const sign = pct > 0 ? '+' : '';
  const pretty = `${sign}${(pct * 100).toFixed(0)}%`;
  return locale === 'es'
    ? `${pretty} vs semana anterior`
    : `${pretty} vs prior week`;
}

function formatHoursMinutes(totalMinutes: number, locale: string): string {
  if (totalMinutes <= 0) return locale === 'es' ? '0 min' : '0 min';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return locale === 'es' ? `${m} min` : `${m}m`;
  if (m === 0) return locale === 'es' ? `${h} h` : `${h}h`;
  return locale === 'es' ? `${h} h ${m} min` : `${h}h ${m}m`;
}
