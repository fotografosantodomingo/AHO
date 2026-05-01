import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/listings/seo';
import { DeleteListingButton } from '@/components/listings/delete-listing-button';

export const runtime = 'edge';

export const dynamic = 'force-dynamic';

interface ListingRow {
  id: string;
  short_id: string;
  status: string;
  title_en: string | null;
  title_es: string | null;
  city: string;
  price_cents: number;
  currency: string;
  image_count: number;
  updated_at: string;
}

export default async function DashboardListingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tStatus = await getTranslations({ locale, namespace: 'dashboard.status' });

  const supabase = await createServerSupabaseClient();

  // Resolve the user's org first. Two reasons we need this BEFORE the
  // listings query:
  //   1. We use it to filter the listings query by org_id explicitly.
  //      Without an explicit filter, RLS lets admins (who have
  //      `properties_admin_all` policy) see every listing across the
  //      whole platform — including RLS test fixtures from
  //      `aho-test-org-a`. The dashboard means "my org's listings",
  //      not "every listing I can see".
  //   2. Plan tracker needs the org's listing_cap + occupying count.
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id;
  let listingCap: number | null = null;
  let occupyingCount = 0;
  let myOrgId: string | null = null;
  if (userId) {
    const { data: membership } = await supabase
      .from('organization_members')
      .select('org_id, organizations!inner(listing_cap)')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    // PostgREST returns related rows from an inner-join as either an
    // object (single relation) or an array, depending on whether the FK
    // is a single-row link. Drizzle / postgres-js sometimes infers it as
    // an array; normalize.
    const orgField = membership?.organizations as
      | { listing_cap: number | null }
      | { listing_cap: number | null }[]
      | null
      | undefined;
    const org = Array.isArray(orgField) ? orgField[0] ?? null : orgField ?? null;
    listingCap = org?.listing_cap ?? null;

    if (membership?.org_id) {
      myOrgId = membership.org_id;
      const { count: occCount } = await supabase
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', membership.org_id)
        .in('status', ['active', 'pending']);
      occupyingCount = occCount ?? 0;
    }
  }

  // Now fetch the listings, scoped to the user's own org. Belt-and-
  // suspenders fixture exclusion (aho-test-org-* + aho-fixture-*) so
  // admin accounts that happen to match a fixture org or have the
  // admin_all RLS policy still don't see fixture rows here. The /admin
  // surface is where fixtures intentionally show up (with a badge).
  let rawListings: ListingRow[] = [];
  let error: { message: string } | null = null;
  if (myOrgId) {
    const { data, error: listErr } = await supabase
      .from('properties')
      .select(
        'id, short_id, status, title_en, title_es, slug_en, slug_es, city, price_cents, currency, image_count, updated_at',
      )
      .eq('org_id', myOrgId)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (listErr) error = { message: listErr.message };
    rawListings = ((data ?? []) as unknown as Array<ListingRow & { slug_en: string | null; slug_es: string | null }>)
      .filter(
        (r) =>
          !r.slug_en?.startsWith('aho-fixture-') &&
          !r.slug_es?.startsWith('aho-fixture-'),
      );
  }

  if (error) {
    return (
      <main>
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      </main>
    );
  }

  const listings = rawListings;
  const newListingPath = `/${locale}/${
    locale === 'es' ? 'panel/propiedades/nuevo' : 'dashboard/properties/new'
  }`;
  const editPathFor = (id: string) =>
    `/${locale}/${locale === 'es' ? 'panel/propiedades' : 'dashboard/properties'}/${id}`;

  const dateFormatter = new Intl.DateTimeFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Pre-compute plan tracker copy. Three states:
  //   - listingCap is null = unlimited (Expert tier in v2; no cap)
  //   - listingCap > occupyingCount = "X / Y · Z remaining"
  //   - listingCap === occupyingCount = "X / Y · plan limit reached"
  const remaining = listingCap == null ? null : Math.max(0, listingCap - occupyingCount);
  const atCap = listingCap != null && occupyingCount >= listingCap;
  const usagePct = listingCap == null ? 0 : Math.min(100, (occupyingCount / listingCap) * 100);
  const planAtCapDisabled = atCap;

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          {t('listingsHeading')}
        </h1>
        <a
          href={planAtCapDisabled ? '#' : newListingPath}
          aria-disabled={planAtCapDisabled || undefined}
          className={`inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium shadow-whisper transition ${
            planAtCapDisabled
              ? 'cursor-not-allowed bg-border-strong/20 text-helper'
              : 'bg-action text-white hover:bg-action-active dark:bg-action-dark dark:text-surface-deep'
          }`}
        >
          {t('newListing')}
        </a>
      </header>

      {/* Plan tracker — shows for every org. Hidden if listingCap is null
          (unlimited tier). Bar fills as the user approaches the cap; flips
          to a warn-color message at the cap. */}
      {listingCap != null && (
        <section
          aria-label={t('planUsage')}
          className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {t('planUsage')}
            </p>
            <p className="font-brand text-base font-semibold tabular-nums">
              {occupyingCount} <span className="text-helper">/ {listingCap}</span>
            </p>
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-border-strong/15"
            role="progressbar"
            aria-valuenow={occupyingCount}
            aria-valuemin={0}
            aria-valuemax={listingCap}
          >
            <div
              className={`h-full transition-all ${
                atCap ? 'bg-warn' : 'bg-action dark:bg-action-dark'
              }`}
              style={{ width: `${usagePct}%` }}
            />
          </div>
          <p className={`mt-2 text-xs ${atCap ? 'text-warn' : 'text-helper'}`}>
            {atCap
              ? t('planUsageAtCap')
              : t(remaining === 1 ? 'planUsageRemaining_one' : 'planUsageRemaining_other', {
                  count: remaining ?? 0,
                })}
          </p>
        </section>
      )}

      {listings.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-12 text-center shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('listingsHeading')}
          </p>
          <h2 className="mt-3 font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
            {t('listingsEmpty')}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted dark:text-ink-inverse-muted">
            {t('emptyHelp')}
          </p>
          <a href={newListingPath} className="btn-primary mt-6">
            {t('listingsEmptyCta')}
          </a>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="text-left">
              <tr>
                <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.title')}
                </th>
                <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.status')}
                </th>
                <th className="hidden px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper md:table-cell">
                  {t('table.city')}
                </th>
                <th className="px-3 py-2 text-right font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.price')}
                </th>
                <th className="hidden px-3 py-2 text-right font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper md:table-cell">
                  {t('table.images')}
                </th>
                <th className="hidden px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper lg:table-cell">
                  {t('table.updated')}
                </th>
                <th className="px-3 py-2 text-right font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.actions')}
                </th>
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
                    <td className="max-w-[160px] px-3 py-2 sm:max-w-[260px] md:max-w-none">
                      <a
                        className="block truncate font-medium underline"
                        href={editPathFor(row.id)}
                      >
                        {title}
                      </a>
                      <span className="text-xs text-helper">{row.short_id}</span>
                      {/* Mobile-only: stack city beneath the title since
                          the dedicated CITY column is hidden <md. */}
                      <span className="block text-xs text-helper md:hidden">
                        {row.city}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} label={tStatus(row.status)} />
                    </td>
                    <td className="hidden px-3 py-2 md:table-cell">{row.city}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPrice(Number(row.price_cents), row.currency, typedLocale)}
                    </td>
                    <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell">{row.image_count}</td>
                    <td className="hidden px-3 py-2 text-helper lg:table-cell">
                      {dateFormatter.format(new Date(row.updated_at))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <a
                          href={editPathFor(row.id)}
                          className="inline-flex h-7 items-center rounded-md border border-border-strong/40 px-2 text-xs transition hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          {t('edit')}
                        </a>
                        <DeleteListingButton id={row.id} label={title} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
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
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
