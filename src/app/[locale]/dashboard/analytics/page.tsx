import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  daysAgo,
  getOrgAnalytics,
  getRecentActivity,
  getTopListingsByEngagement,
} from '@/lib/analytics/queries';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile, formatRelativeTime } from '@/components/analytics/stat-tile';
import Link from 'next/link';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /{locale}/dashboard/analytics — agent performance dashboard.
 *
 * Reads aggregate counts, top listings, and recent activity from
 * `property_events` (migration 0027). RLS gates everything to the
 * agent's own org.
 *
 * Empty state: an agent with no events yet (no live listings or
 * just-published) sees a friendly "your analytics will appear here"
 * panel. No mock numbers — honest emptiness per CLAUDE.md hard rule #8.
 */
export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'analytics' });
  const tNav = await getTranslations({ locale, namespace: 'dashboard' });

  // Auth + org membership are already enforced by /dashboard/layout.tsx.
  // Pull the user's org from there (membership is guaranteed at this point).
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user!.id;
  const { data: memberships } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', userId)
    .limit(1);
  const orgId = memberships?.[0]?.org_id;
  if (!orgId) {
    // Layout should have redirected to /pricing — defensive no-op.
    return null;
  }

  // Three windows: 7d (primary), 30d (context).
  const since7d = daysAgo(7);
  const since30d = daysAgo(30);

  const [analytics7d, analytics30d, topListings, activity] = await Promise.all([
    getOrgAnalytics(supabase, orgId, since7d),
    getOrgAnalytics(supabase, orgId, since30d),
    getTopListingsByEngagement(supabase, orgId, since30d, typedLocale, 10),
    getRecentActivity(supabase, orgId, typedLocale, 20),
  ]);

  const hasAnyData = analytics30d.total > 0;

  const browseHref = localePath(locale as Locale, '/dashboard/properties');

  return (
    <main className="space-y-8">
      <header>
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {tNav('navAnalytics')}
        </p>
        <h1 className="mt-1 font-brand text-2xl font-semibold tracking-tight md:text-[32px] md:leading-[1.15]">
          {t('heading')}
        </h1>
        <p className="mt-1 text-sm text-helper">{t('subheading')}</p>
      </header>

      {!hasAnyData ? (
        <EmptyState
          heading={t('emptyHeading')}
          body={t('emptyBody')}
          primaryCta={
            <Link href={browseHref} className="btn-primary">
              {t('emptyCta')}
            </Link>
          }
        />
      ) : (
        <>
          {/* Top stat row — 4 metrics with 7d primary + 30d context. */}
          <section
            aria-label={t('statsAria')}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
          >
            <StatTile
              label={t('statViews')}
              primary={analytics7d.byType.property_view ?? 0}
              secondary={analytics30d.byType.property_view ?? 0}
              secondaryLabel={t('past30d')}
            />
            <StatTile
              label={t('statLeads')}
              primary={analytics7d.byType.lead_form_submit ?? 0}
              secondary={analytics30d.byType.lead_form_submit ?? 0}
              secondaryLabel={t('past30d')}
            />
            <StatTile
              label={t('statFavorites')}
              primary={analytics7d.byType.favorite_add ?? 0}
              secondary={analytics30d.byType.favorite_add ?? 0}
              secondaryLabel={t('past30d')}
            />
            <StatTile
              label={t('statConversion')}
              primary={
                analytics30d.conversionRate != null
                  ? `${(analytics30d.conversionRate * 100).toFixed(1)}%`
                  : '—'
              }
              secondary={null}
              secondaryLabel={t('past30dWindow')}
            />
          </section>

          {/* Top listings table. */}
          {topListings.length > 0 && (
            <section
              aria-labelledby="top-listings-heading"
              className="space-y-3"
            >
              <h2
                id="top-listings-heading"
                className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
              >
                {t('topListingsHeading')}
              </h2>
              <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-whisper">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-border text-left">
                    <tr>
                      <th className="px-3 py-2 font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper">
                        {t('colTitle')}
                      </th>
                      <th className="hidden px-3 py-2 font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper md:table-cell">
                        {t('colCity')}
                      </th>
                      <th className="px-3 py-2 text-right font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper">
                        {t('colViews')}
                      </th>
                      <th className="px-3 py-2 text-right font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper">
                        {t('colLeads')}
                      </th>
                      <th className="hidden px-3 py-2 text-right font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper sm:table-cell">
                        {t('colFavorites')}
                      </th>
                      <th className="hidden px-3 py-2 text-right font-brand text-[11px] font-semibold uppercase tracking-[0.1em] text-helper md:table-cell">
                        {t('colConv')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {topListings.map((row) => {
                      const conv = row.conversionRate;
                      const drillSegment =
                        typedLocale === 'es'
                          ? 'panel/estadisticas'
                          : 'dashboard/analytics';
                      const drillHref = `/${typedLocale}/${drillSegment}/${row.propertyId}`;
                      return (
                        <tr
                          key={row.propertyId}
                          className="transition hover:bg-surface-warm/40 dark:hover:bg-surface-dark/40"
                        >
                          <td className="max-w-[240px] truncate px-3 py-2 font-medium">
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
                            {row.views}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.leads}
                          </td>
                          <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
                            {row.favorites}
                          </td>
                          <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
                            {conv != null ? `${(conv * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Recent activity feed. */}
          {activity.length > 0 && (
            <section
              aria-labelledby="activity-heading"
              className="space-y-3"
            >
              <h2
                id="activity-heading"
                className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
              >
                {t('activityHeading')}
              </h2>
              <ul className="divide-y divide-border/60 rounded-card border border-border bg-surface text-sm shadow-whisper">
                {activity.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-action/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-action"
                      title={row.eventType}
                    >
                      {t(`eventType.${row.eventType}` as 'eventType.property_view')}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {row.propertyTitle}
                    </span>
                    <span className="hidden shrink-0 text-xs text-helper sm:inline">
                      {t(`visitor.${row.visitorType}` as 'visitor.auth')}
                    </span>
                    <span className="shrink-0 text-xs text-helper tabular-nums">
                      {formatRelativeTime(row.createdAt, typedLocale)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
