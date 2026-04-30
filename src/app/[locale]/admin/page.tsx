import { setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/listings/format';
import { ArchiveButton } from '@/components/admin/archive-button';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Admin → Listings tab. Shows all listings across all orgs with a status
 * filter and an archive action. Auth + tab nav live in the parent layout.
 *
 * Fixture exclusion: NOT applied here — admins SHOULD see fixture rows
 * during dev so they can spot anomalies. Public surfaces (sitemap, city
 * landing, agent profiles, by-bbox API) all filter fixtures correctly.
 */

export const metadata = {
  title: 'Admin · Listings · AHO',
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

export default async function AdminListingsPage({
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

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('properties')
    .select(
      'id, short_id, status, title_en, title_es, city, country_code, price_cents, currency, image_count, created_at, updated_at, organizations!inner(id, name, slug)',
    )
    .order('updated_at', { ascending: false })
    .limit(200);

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data: rows, error } = await query;
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    );
  }

  const listings = (rows ?? []).map((r) => ({
    ...r,
    org: Array.isArray(r.organizations)
      ? (r.organizations[0] ?? null)
      : (r.organizations ?? null),
  })) as unknown as AdminListing[];

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
            ? 'bg-surface-dark text-ink-inverse-muted shadow-whisper'
            : 'text-helper hover:bg-black/5 dark:hover:bg-white/5'
        }`}
      >
        {label}
      </a>
    );
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          Listings ({listings.length})
        </h1>
        <nav className="flex flex-wrap gap-1" aria-label="Status filter">
          {filterTab('all', 'All')}
          {filterTab('active', 'Active')}
          {filterTab('draft', 'Draft')}
          {filterTab('pending', 'Pending')}
          {filterTab('archived', 'Archived')}
        </nav>
      </div>

      {listings.length === 0 ? (
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
                      {row.city}, {row.country_code}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPrice(Number(row.price_cents), row.currency, typedLocale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.image_count}</td>
                    <td className="px-3 py-2 text-helper">
                      {dateFormatter.format(new Date(row.updated_at))}
                    </td>
                    <td className="px-3 py-2">
                      <ArchiveButton propertyId={row.id} status={row.status} />
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
