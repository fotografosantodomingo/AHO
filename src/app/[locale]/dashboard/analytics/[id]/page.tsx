import { notFound } from 'next/navigation';
import Link from 'next/link';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  daysAgo,
  getPropertyAnalytics,
  getPropertyRecentActivity,
} from '@/lib/analytics/queries';
import { StatTile, formatRelativeTime } from '@/components/analytics/stat-tile';
import { SocialPerformanceSection } from '@/components/analytics/social-performance-section';
import { getPerformanceForListing } from '@/lib/listings/listing-performance';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /{locale}/dashboard/analytics/[id] — per-listing performance drill-down.
 *
 * Same shape as the org-summary surface but scoped to a single property:
 * 4 stat tiles (views / leads / saves / lead-rate, all per-VISITOR
 * deduped, see commit ff017b6) + the full activity feed for this
 * listing (50 most recent events).
 *
 * RLS gating: the agent's user-context client + `property_events_org_select`
 * policy already restricts events to their own org. The properties
 * lookup uses the same client; if the agent passes a property_id they
 * can't see (different org), the lookup returns null and we
 * `notFound()`.
 *
 * Auth + org membership are enforced by /dashboard/layout.tsx.
 */
export default async function PropertyAnalyticsPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'analytics' });
  const tNav = await getTranslations({ locale, namespace: 'dashboard' });

  const supabase = await createServerSupabaseClient();

  // Resolve the property — RLS will deny rows the agent doesn't own.
  const { data: property, error } = await supabase
    .from('properties')
    .select('id, short_id, slug_en, slug_es, status, title_en, title_es, city, country_code')
    .eq('id', id)
    .maybeSingle();
  if (error || !property) notFound();

  const propertyTitle =
    (typedLocale === 'es' ? property.title_es : property.title_en) ??
    property.title_en ??
    property.title_es ??
    '—';

  const since7d = daysAgo(7);
  const since30d = daysAgo(30);

  const [analytics7d, analytics30d, activity, planCtx] = await Promise.all([
    getPropertyAnalytics(supabase, property.id as string, since7d),
    getPropertyAnalytics(supabase, property.id as string, since30d),
    getPropertyRecentActivity(
      supabase,
      property.id as string,
      typedLocale,
      50,
    ),
    getCurrentUserOrgPlan(supabase),
  ]);

  // Sprint 3 — "Social performance" tab is plan-gated to Pro Automation
  // (matches the /dashboard/social gating). Lower tiers don't see the
  // empty state; they see no extra section.
  const showSocialPerformance = planCtx
    ? await isOrgOnProAutomation(supabase, planCtx.orgId)
    : false;
  const socialPerformance = showSocialPerformance
    ? await getPerformanceForListing(supabase, property.id as string)
    : null;

  const analyticsBackHref = localePath(typedLocale, '/dashboard/analytics');
  const slugForLocale =
    typedLocale === 'es' ? property.slug_es : property.slug_en;
  const propertyStem = localePath(typedLocale, '/properties/[slug]').replace(
    '/[slug]',
    '',
  );
  const publicHref =
    property.status === 'active' && slugForLocale
      ? `${propertyStem}/${slugForLocale}-${property.short_id}`
      : null;

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <Link
          href={analyticsBackHref}
          className="inline-flex items-center text-xs text-helper transition hover:text-action dark:hover:text-action-dark"
        >
          {t('drilldown.backToAll')}
        </Link>
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {tNav('navAnalytics')}
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px] md:leading-[1.15]">
            {t('drilldown.headingPrefix')} {propertyTitle}
          </h1>
          {publicHref && (
            <a
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {t('drilldown.viewPublic')}
            </a>
          )}
        </div>
        <p className="text-sm text-helper">
          <span className="font-mono text-xs">{property.short_id as string}</span>
          {property.city ? <> · {property.city as string}</> : null}
        </p>
      </header>

      {/* Stat tiles. Same labels as the org page; numbers scoped to this listing. */}
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

      {/* Sprint 3 — "Social performance" section. Pro Automation only.
          Renders honest-empty today (no rows in listing_post_metrics);
          lights up automatically when the Meta Insights cron + FB Lead
          Ads webhook start populating snapshots. */}
      {socialPerformance && (
        <SocialPerformanceSection
          locale={typedLocale}
          performance={socialPerformance}
        />
      )}

      {/* Full activity feed for this listing (50 most recent events). */}
      <section aria-labelledby="listing-activity-heading" className="space-y-3">
        <h2
          id="listing-activity-heading"
          className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
        >
          {t('drilldown.viewListingActivityHeading')}
        </h2>
        {activity.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-strong/60 bg-surface p-8 text-center text-sm text-helper shadow-whisper dark:bg-surface-deep">
            <p>{t('drilldown.noActivity')}</p>
            <p className="mt-2 text-xs">{t('drilldown.noActivityHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 rounded-card border border-border bg-surface text-sm shadow-whisper">
            {activity.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-3 py-2">
                <span
                  className="inline-flex shrink-0 items-center rounded-full bg-action/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-action"
                  title={row.eventType}
                >
                  {t(`eventType.${row.eventType}` as 'eventType.property_view')}
                </span>
                <span className="hidden shrink-0 text-xs text-helper sm:inline">
                  {t(`visitor.${row.visitorType}` as 'visitor.auth')}
                </span>
                {row.source && (
                  <span className="hidden shrink-0 truncate text-xs text-helper md:inline">
                    {row.source}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-helper tabular-nums">
                  {formatRelativeTime(row.createdAt, typedLocale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
