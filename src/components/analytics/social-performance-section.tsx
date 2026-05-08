import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import type {
  ListingPerformance,
  PerformancePlatformTile,
  PerformancePostRow,
  PerformanceSparkPoint,
} from '@/lib/listings/listing-performance';

interface Props {
  locale: Locale;
  performance: ListingPerformance;
}

/**
 * Sprint 3 — "Social performance" section appended below the existing
 * per-listing analytics drilldown.
 *
 * States:
 *   - Empty (zero rows from listing_post_metrics — the state TODAY,
 *     because Meta App Review hasn't approved live publishing and the
 *     FB Lead Ads webhook isn't wired). Shows an honest empty state
 *     with a CTA to /dashboard/social so the agent connects accounts
 *     while we wait for the writer pipeline.
 *   - Populated. Shows per-platform tiles, a 30-day reach sparkline,
 *     and a per-post breakdown table.
 *
 * Plan-gating happens at the page level (`isOrgOnProAutomation`) — by
 * the time this component renders, the user is on Pro Automation.
 */
export async function SocialPerformanceSection({ locale, performance }: Props) {
  const t = await getTranslations({ locale, namespace: 'analytics' });
  const tSocial = await getTranslations({ locale, namespace: 'social' });
  const socialHref = `/${locale}/${locale === 'es' ? 'panel/social' : 'dashboard/social'}`;

  return (
    <section
      aria-labelledby="social-performance-heading"
      className="space-y-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="social-performance-heading"
          className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
        >
          {t('social.heading')}
        </h2>
      </div>

      {performance.isEmpty ? (
        <div className="rounded-card border border-dashed border-border-strong/60 bg-surface p-8 text-center text-sm text-helper shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-base font-semibold text-ink">
            {t('social.emptyHeading')}
          </p>
          <p className="mt-2 text-xs text-helper">{t('social.emptyBody')}</p>
          <p className="mt-4">
            <Link
              href={socialHref}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
            >
              {t('social.emptyCta')}
            </Link>
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <ul
            aria-label={t('social.tilesAria')}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {performance.perPlatform.map((tile) => (
              <li key={tile.platform}>
                <PlatformTile
                  tile={tile}
                  locale={locale}
                  platformLabel={tSocial(
                    `platform.${tile.platform}` as 'platform.facebook',
                  )}
                  reachLabel={t('social.reach')}
                  leadsLabel={t('social.leads')}
                  cplLabel={t('social.cpl')}
                  organicLabel={t('social.organic')}
                  lastPostLabel={t('social.lastPost')}
                  lastPostNeverLabel={t('social.lastPostNever')}
                  postsLabel={t('social.posts')}
                />
              </li>
            ))}
          </ul>

          <SparklineCard
            points={performance.sparkline30d}
            label={t('social.sparklineLabel')}
            srLabel={t('social.sparklineSrLabel')}
            locale={locale}
          />

          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper">
            <table className="w-full text-sm">
              <thead className="bg-surface-muted/40 text-left text-xs uppercase tracking-wider text-helper">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('social.colDate')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('social.colPlatform')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('social.colReach')}
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 text-right font-medium sm:table-cell"
                  >
                    {t('social.colClicks')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    {t('social.colLeads')}
                  </th>
                  <th
                    scope="col"
                    className="hidden px-3 py-2 text-right font-medium md:table-cell"
                  >
                    {t('social.colCpl')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {performance.recentPosts.map((row) => (
                  <PostRow
                    key={`${row.platform}-${row.postExternalId}`}
                    row={row}
                    locale={locale}
                    platformLabel={tSocial(
                      `platform.${row.platform}` as 'platform.facebook',
                    )}
                    organicLabel={t('social.organic')}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

interface PlatformTileProps {
  tile: PerformancePlatformTile;
  locale: Locale;
  platformLabel: string;
  reachLabel: string;
  leadsLabel: string;
  cplLabel: string;
  organicLabel: string;
  lastPostLabel: string;
  lastPostNeverLabel: string;
  postsLabel: string;
}

function PlatformTile({
  tile,
  locale,
  platformLabel,
  reachLabel,
  leadsLabel,
  cplLabel,
  organicLabel,
  lastPostLabel,
  lastPostNeverLabel,
  postsLabel,
}: PlatformTileProps) {
  const cpl =
    tile.avgCplCents == null
      ? organicLabel
      : formatMoneyCents(tile.avgCplCents, tile.cplCurrency, locale);
  const lastPost = tile.lastPostedAt
    ? formatShortDate(tile.lastPostedAt, locale)
    : lastPostNeverLabel;

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-whisper">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-brand text-sm font-semibold tracking-tight">
          {platformLabel}
        </p>
        <p className="text-[11px] text-helper">
          {tile.postCount} {postsLabel}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-helper">{reachLabel}</dt>
          <dd className="mt-0.5 font-brand text-lg font-semibold tabular-nums">
            {formatCount(tile.totalReach, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-helper">{leadsLabel}</dt>
          <dd className="mt-0.5 font-brand text-lg font-semibold tabular-nums">
            {formatCount(tile.totalLeads, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-helper">{cplLabel}</dt>
          <dd className="mt-0.5 font-brand text-lg font-semibold tabular-nums">
            {cpl}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-helper">
        {lastPostLabel}: <span className="tabular-nums">{lastPost}</span>
      </p>
    </div>
  );
}

interface PostRowProps {
  row: PerformancePostRow;
  locale: Locale;
  platformLabel: string;
  organicLabel: string;
}

function PostRow({ row, locale, platformLabel, organicLabel }: PostRowProps) {
  const cpl =
    row.cplCents == null
      ? organicLabel
      : formatMoneyCents(row.cplCents, row.currency, locale);
  return (
    <tr>
      <td className="px-3 py-2 text-helper tabular-nums">
        {formatShortDate(row.postedAt, locale)}
      </td>
      <td className="px-3 py-2">{platformLabel}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatCount(row.reach, locale)}
      </td>
      <td className="hidden px-3 py-2 text-right tabular-nums sm:table-cell">
        {formatCount(row.clicks, locale)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {formatCount(row.leads, locale)}
      </td>
      <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">
        {cpl}
      </td>
    </tr>
  );
}

interface SparklineCardProps {
  points: PerformanceSparkPoint[];
  label: string;
  srLabel: string;
  locale: Locale;
}

/**
 * Plain-SVG sparkline. Recharts isn't a project dependency, so we
 * draw the line directly. Width is a fixed 600 viewBox; the SVG
 * scales to its container via `width="100%"`.
 */
function SparklineCard({ points, label, srLabel, locale }: SparklineCardProps) {
  const width = 600;
  const height = 80;
  const padX = 8;
  const padY = 8;
  const maxReach = Math.max(0, ...points.map((p) => p.reach));
  const last = points[points.length - 1];

  if (maxReach === 0) {
    // All-zero series — render the axis baseline only, keeps the layout
    // stable when a Pro user has snapshot rows but zero reach today.
    return (
      <div className="rounded-card border border-border bg-surface p-4 shadow-whisper">
        <p className="text-xs font-medium uppercase tracking-wider text-helper">
          {label}
        </p>
        <svg
          role="img"
          aria-label={srLabel}
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          className="mt-2 block h-20"
        >
          <line
            x1={padX}
            y1={height - padY}
            x2={width - padX}
            y2={height - padY}
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
        </svg>
      </div>
    );
  }

  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const points2d = points.map((p, i) => {
    const x = padX + i * stepX;
    const y = padY + innerH - (p.reach / maxReach) * innerH;
    return [x, y] as const;
  });
  const linePath = points2d
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
  const areaPath =
    `M${points2d[0]![0].toFixed(1)},${(height - padY).toFixed(1)} ` +
    points2d
      .map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ') +
    ` L${points2d[points2d.length - 1]![0].toFixed(1)},${(height - padY).toFixed(1)} Z`;

  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-whisper">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-helper">
          {label}
        </p>
        {last && (
          <p className="text-xs text-helper tabular-nums">
            {formatCount(last.reach, locale)}
          </p>
        )}
      </div>
      <svg
        role="img"
        aria-label={srLabel}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        className="mt-2 block h-20 text-action"
      >
        <path d={areaPath} fill="currentColor" fillOpacity="0.12" />
        <path
          d={linePath}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ── formatting helpers ─────────────────────────────────────────────

function localeForFmt(locale: Locale): string {
  switch (locale) {
    case 'es':
      return 'es-DO';
    case 'pl':
      return 'pl-PL';
    case 'pt':
      return 'pt-PT';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'it':
      return 'it-IT';
    default:
      return 'en-US';
  }
}

function formatCount(n: number, locale: Locale): string {
  return new Intl.NumberFormat(localeForFmt(locale)).format(n);
}

function formatMoneyCents(
  cents: number,
  currency: string,
  locale: Locale,
): string {
  // Drop fractional cents for display — CPL precision below $0.01 is noise.
  const major = cents / 100;
  try {
    return new Intl.NumberFormat(localeForFmt(locale), {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    // Unknown currency code — fall back to USD shape so we never throw.
    return new Intl.NumberFormat(localeForFmt(locale), {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(major);
  }
}

function formatShortDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeForFmt(locale), {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}
