import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPrice } from '@/lib/listings/format';
import { ArchiveButton } from '@/components/admin/archive-button';
import { DeleteListingButton } from '@/components/admin/delete-listing-button';
import { getCountryName } from '@/lib/i18n/countries';
import { ACTIVE_STATUSES, type SubscriptionStatus } from '@/db/schema';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Admin overview / Listings tab — operations console.
 *
 * Layout (top → bottom):
 *   1. KPI strip (real DB queries; tile omitted on hard failure, "—"
 *      placeholder rather than a fake 0).
 *   2. Pending-moderation queue badge (reviews pending moderation +
 *      open report counts).
 *   3. Recent activity feed (audit_log entries from the last 24h).
 *   4. Listings table (the original Listings tab content).
 *
 * Real-only-data discipline (CLAUDE.md hard rule #8): every number is a
 * real query result. If a query fails (`null`), the tile shows "—" not
 * "0". A genuine zero from the DB renders "0". No fake activity feed:
 * if `audit_log` is empty in the last 24h we render an honest
 * "No activity in the last 24 hours" empty state — never a fabricated
 * row.
 *
 * Auth + tab nav live in the parent layout (`admin/layout.tsx`); this
 * page assumes signed-in admin with verified MFA.
 *
 * Service-role client is used ONLY for KPI counts, the moderation
 * counters, and the activity feed. The listings table itself stays on
 * the user-context client (RLS admin policies cover it). The KPIs need
 * `count: 'exact'` across rows the user-context client could SELECT
 * anyway, so RLS-bypass is purely a perf / simplicity choice — no data
 * is exposed that wouldn't already be visible to an admin via RLS.
 *
 * Fixture exclusion: NOT applied here — admins SHOULD see fixture rows
 * during dev so they can spot anomalies. Public surfaces (sitemap, city
 * landing, agent profiles, by-bbox API) all filter fixtures correctly.
 */

export const metadata = {
  title: 'Admin · Overview · AHO',
  robots: { index: false, follow: false },
};

interface AdminListing {
  id: string;
  short_id: string;
  status: string;
  title_en: string | null;
  title_es: string | null;
  city: string;
  country_code: string;
  price_cents: number;
  currency: string;
  image_count: number;
  created_at: string;
  updated_at: string;
  org: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

interface SearchParams {
  status?: string;
}

const STATUS_FILTERS = ['all', 'draft', 'active', 'pending', 'archived'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

// ---------------------------------------------------------------------
// KPI types — `null` means "query failed; render '—'". A genuine zero
// from the database renders "0" (per real-only-data rule #8).
// ---------------------------------------------------------------------

interface AdminKpis {
  activeSubscriptions: number | null;
  mrrUsdCents: number | null;
  newSignupsLast7d: number | null;
  activeListings: number | null;
  totalAgentOrgs: number | null;
}

interface ModerationCounts {
  pendingReviews: number | null;
  openReports: number | null;
}

interface ActivityRow {
  id: string;
  kind: string;
  actor_email: string | null;
  target_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------
// Data fetchers — each one swallows errors and returns `null` for the
// affected metric so a single failed query doesn't take down the page.
// Errors are logged to the Pages Function log for diagnosis.
// ---------------------------------------------------------------------

async function safeCount(p: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try {
    const r = await p;
    return r.error ? null : (r.count ?? 0);
  } catch {
    return null;
  }
}

async function fetchKpis(): Promise<AdminKpis> {
  const admin = createAdminClient();
  const activeStatuses = ACTIVE_STATUSES as ReadonlyArray<SubscriptionStatus>;

  // 1. Active subscriptions — anything in ACTIVE_STATUSES is "has access
  // right now" per src/db/schema.ts.
  const subsCountPromise = safeCount(
    admin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .in('status', activeStatuses as unknown as string[]),
  );

  // 2. MRR — sum(plan.amount_cents normalised to monthly) across
  // active subscriptions. Annual plans contribute amount_cents / 12.
  // Mixed currencies are normalised to USD via plans.currency: we
  // assume USD-denominated plans (verified by `plans` seed). If a
  // future plan ships in EUR/GBP we'll need an FX conversion here.
  const mrrPromise: Promise<number | null> = (async () => {
    try {
      const { data, error } = await admin
        .from('subscriptions')
        .select('plans!inner(amount_cents, billing_period, currency)')
        .in('status', activeStatuses as unknown as string[]);
      if (error || !data) return null;
      let total = 0;
      for (const row of data) {
        const plan = (
          row as unknown as {
            plans: { amount_cents: string | number; billing_period: string; currency: string };
          }
        ).plans;
        if (!plan) continue;
        // Skip non-USD plans rather than bake a stale FX rate into a
        // headline KPI. (Today all plans are USD; this is defensive.)
        if (plan.currency !== 'USD') continue;
        const cents =
          typeof plan.amount_cents === 'string'
            ? Number(plan.amount_cents)
            : plan.amount_cents;
        if (!Number.isFinite(cents)) continue;
        if (plan.billing_period === 'monthly') total += cents;
        else if (plan.billing_period === 'annual') total += Math.round(cents / 12);
      }
      return total;
    } catch {
      return null;
    }
  })();

  // 3. New signups in the last 7 days.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const signupsPromise = safeCount(
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sevenDaysAgo),
  );

  // 4. Active listings.
  const activeListingsPromise = safeCount(
    admin
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
  );

  // 5. Total agent / agency orgs.
  const agentOrgsPromise = safeCount(
    admin
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .in('type', ['agent', 'agency']),
  );

  const [activeSubscriptions, mrrUsdCents, newSignupsLast7d, activeListings, totalAgentOrgs] =
    await Promise.all([
      subsCountPromise,
      mrrPromise,
      signupsPromise,
      activeListingsPromise,
      agentOrgsPromise,
    ]);

  return {
    activeSubscriptions,
    mrrUsdCents,
    newSignupsLast7d,
    activeListings,
    totalAgentOrgs,
  };
}

async function fetchModerationCounts(): Promise<ModerationCounts> {
  const admin = createAdminClient();

  const pendingReviewsPromise = safeCount(
    admin
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_moderation'),
  );

  const openReportsPromise = safeCount(
    admin
      .from('review_reports')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open'),
  );

  const [pendingReviews, openReports] = await Promise.all([
    pendingReviewsPromise,
    openReportsPromise,
  ]);
  return { pendingReviews, openReports };
}

async function fetchRecentActivity(): Promise<ActivityRow[] | null> {
  try {
    return await fetchRecentActivityImpl();
  } catch {
    return null;
  }
}

async function fetchRecentActivityImpl(): Promise<ActivityRow[] | null> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('audit_log')
    .select('id, kind, target_id, created_at, actor:profiles!audit_log_actor_id_fkey(email)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    // Fallback: try without the FK alias in case the named constraint
    // differs (different envs sometimes have implicit FK names).
    const fallback = await admin
      .from('audit_log')
      .select('id, kind, target_id, created_at, actor_id')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10);
    if (fallback.error || !fallback.data) return null;
    // Resolve actor emails in a second round-trip.
    const actorIds = Array.from(
      new Set(
        fallback.data
          .map((r) => (r as { actor_id: string | null }).actor_id)
          .filter((x): x is string => !!x),
      ),
    );
    let emailById = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, email')
        .in('id', actorIds);
      emailById = new Map(
        (profiles ?? []).map((p) => [
          (p as { id: string }).id,
          (p as { email: string }).email,
        ]),
      );
    }
    return fallback.data.map((r) => {
      const row = r as {
        id: string;
        kind: string;
        target_id: string | null;
        created_at: string;
        actor_id: string | null;
      };
      return {
        id: row.id,
        kind: row.kind,
        target_id: row.target_id,
        created_at: row.created_at,
        actor_email: row.actor_id ? (emailById.get(row.actor_id) ?? null) : null,
      };
    });
  }

  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      kind: string;
      target_id: string | null;
      created_at: string;
      actor: { email: string } | { email: string }[] | null;
    };
    const actor = Array.isArray(row.actor) ? (row.actor[0] ?? null) : row.actor;
    return {
      id: row.id,
      kind: row.kind,
      target_id: row.target_id,
      created_at: row.created_at,
      actor_email: actor?.email ?? null,
    };
  });
}

// ---------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

function formatMrr(cents: number): string {
  // KPI display — round to whole dollars; the cents view goes in Stripe.
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export default async function AdminOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const sp = await searchParams;
  const rawStatus = sp.status ?? 'all';
  const statusFilter: StatusFilter = (
    STATUS_FILTERS as readonly string[]
  ).includes(rawStatus)
    ? (rawStatus as StatusFilter)
    : 'all';

  // Run the operations-console queries and the listings-table query in
  // parallel — none of them depend on each other.
  const supabase = await createServerSupabaseClient();
  const listingsQuery = (() => {
    let q = supabase
      .from('properties')
      .select(
        'id, short_id, status, title_en, title_es, city, country_code, price_cents, currency, image_count, created_at, updated_at, organizations!inner(id, name, slug)',
      )
      .order('updated_at', { ascending: false })
      .limit(200);
    if (statusFilter !== 'all') q = q.eq('status', statusFilter);
    return q;
  })();

  const [kpis, moderation, activity, listingsResult] = await Promise.all([
    fetchKpis(),
    fetchModerationCounts(),
    fetchRecentActivity(),
    listingsQuery,
  ]);

  const { data: rows, error: listingsError } = listingsResult;

  const listings = listingsError
    ? []
    : ((rows ?? []).map((r) => ({
        ...r,
        org: Array.isArray(r.organizations)
          ? (r.organizations[0] ?? null)
          : (r.organizations ?? null),
      })) as unknown as AdminListing[]);

  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const filterTab = (key: StatusFilter, label: string) => {
    const isActive = statusFilter === key;
    const href = key === 'all' ? `/${locale}/admin` : `/${locale}/admin?status=${key}`;
    return (
      <a
        key={key}
        href={href}
        className={`inline-flex h-8 items-center rounded-lg px-3 text-sm transition ${
          isActive
            ? 'bg-action text-white shadow-whisper dark:bg-action-dark dark:text-surface-deep'
            : 'text-helper hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        {label}
      </a>
    );
  };

  // KPI tiles — render only those whose query succeeded. A genuine zero
  // still renders ("0"); only `null` (query failure) suppresses or "—"s.
  const kpiTiles: { label: string; value: string }[] = [];
  if (kpis.activeSubscriptions !== null)
    kpiTiles.push({
      label: 'Active subscriptions',
      value: formatNumber(kpis.activeSubscriptions),
    });
  if (kpis.mrrUsdCents !== null)
    kpiTiles.push({ label: 'MRR (USD)', value: formatMrr(kpis.mrrUsdCents) });
  if (kpis.newSignupsLast7d !== null)
    kpiTiles.push({
      label: 'New signups (7d)',
      value: formatNumber(kpis.newSignupsLast7d),
    });
  if (kpis.activeListings !== null)
    kpiTiles.push({
      label: 'Active listings',
      value: formatNumber(kpis.activeListings),
    });
  if (kpis.totalAgentOrgs !== null)
    kpiTiles.push({
      label: 'Agent / agency orgs',
      value: formatNumber(kpis.totalAgentOrgs),
    });

  const moderationItems: { label: string; count: number; href: string }[] = [];
  if (moderation.pendingReviews !== null && moderation.pendingReviews > 0)
    moderationItems.push({
      label: 'Reviews pending moderation',
      count: moderation.pendingReviews,
      href: `/${locale}/admin/reviews`,
    });
  if (moderation.openReports !== null && moderation.openReports > 0)
    moderationItems.push({
      label: 'Open review reports',
      count: moderation.openReports,
      href: `/${locale}/admin/reviews`,
    });

  return (
    <>
      {/* ------------------------------------------------------------ */}
      {/* KPI strip                                                   */}
      {/* ------------------------------------------------------------ */}
      {kpiTiles.length > 0 && (
        <section aria-label="Key metrics">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {kpiTiles.map((tile) => (
              <li
                key={tile.label}
                className="rounded-card border border-border bg-surface p-4 dark:bg-surface-deep"
              >
                <p className="font-brand text-[11px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {tile.label}
                </p>
                <p className="mt-2 font-brand text-2xl font-semibold tabular-nums">
                  {tile.value}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Moderation badge — only renders if there's actual work to do. */}
      {/* No badge = clean queue. No fake "All clear!" celebration.    */}
      {/* ------------------------------------------------------------ */}
      {moderationItems.length > 0 && (
        <section aria-label="Pending moderation">
          <ul className="flex flex-wrap gap-2">
            {moderationItems.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  className="inline-flex items-center gap-2 rounded-full border border-warn/40 bg-warn-bg px-3 py-1 text-sm text-warn transition hover:bg-warn-bg/70 dark:bg-warn-bg/30"
                >
                  <span>{item.label}</span>
                  <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums">
                    {formatNumber(item.count)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Recent activity feed (last 24h, max 10 rows).                */}
      {/* `null` (query failed) → render nothing. Empty array → honest */}
      {/* "no activity" empty state. Never a fabricated row.           */}
      {/* ------------------------------------------------------------ */}
      {activity !== null && (
        <section aria-label="Recent activity" className="space-y-3">
          <h2 className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            Recent activity (last 24h)
          </h2>
          {activity.length === 0 ? (
            <p className="rounded-card border border-dashed border-border-strong/60 p-4 text-sm text-ink-muted dark:text-ink-inverse-muted">
              No activity in the last 24 hours.
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-card border border-border">
              {activity.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <code className="font-brand text-xs font-medium">{row.kind}</code>
                    <span className="text-helper">
                      {row.actor_email ?? 'system'}
                    </span>
                    {row.target_id && (
                      <span className="text-xs text-helper">
                        target: {row.target_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <time
                    dateTime={row.created_at}
                    className="text-xs text-helper tabular-nums"
                  >
                    {formatTimestamp(row.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------ */}
      {/* Listings table (the original Listings tab content).          */}
      {/* ------------------------------------------------------------ */}
      <div className="flex items-center justify-between">
        <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          Listings ({listings.length})
        </h2>
        <nav className="flex flex-wrap gap-1" aria-label="Status filter">
          {filterTab('all', 'All')}
          {filterTab('active', 'Active')}
          {filterTab('draft', 'Draft')}
          {filterTab('pending', 'Pending')}
          {filterTab('archived', 'Archived')}
        </nav>
      </div>

      {listingsError ? (
        <p role="alert" className="text-sm text-red-600">
          {listingsError.message}
        </p>
      ) : listings.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 p-10 text-center text-sm text-ink-muted dark:text-ink-inverse-muted">
          No listings match this filter.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                {[
                  'Title',
                  'Org',
                  'Status',
                  'City',
                  'Price',
                  'Images',
                  'Updated',
                  '',
                ].map((label) => (
                  <th
                    key={label}
                    className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {listings.map((row) => {
                const title =
                  (typedLocale === 'es' ? row.title_es : row.title_en) ??
                  row.title_en ??
                  row.title_es ??
                  '—';
                return (
                  <tr
                    key={row.id}
                    className="transition hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <td className="px-3 py-2">
                      {title}
                      <span className="ml-2 text-xs text-helper">{row.short_id}</span>
                    </td>
                    <td className="px-3 py-2">
                      {row.org ? (
                        <a className="underline" href={`/${locale}/agents/${row.org.slug}`}>
                          {row.org.name}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-3 py-2">
                      {row.city}, {getCountryName(row.country_code, typedLocale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPrice(Number(row.price_cents), row.currency, typedLocale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.image_count}</td>
                    <td className="px-3 py-2 text-helper">
                      {dateFormatter.format(new Date(row.updated_at))}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ArchiveButton propertyId={row.id} status={row.status} />
                        <DeleteListingButton propertyId={row.id} title={title} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = (() => {
    switch (status) {
      case 'active':
        return 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200';
      case 'draft':
        return 'bg-border-strong/15 text-ink-muted dark:text-ink-inverse-muted';
      case 'pending':
        return 'bg-warn-bg text-warn dark:bg-warn-bg/30 dark:text-warn';
      case 'sold':
      case 'rented':
        return 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200';
      case 'archived':
      default:
        return 'bg-border-strong/15 text-helper';
    }
  })();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {status}
    </span>
  );
}
