import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/listings/seo';

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

  // RLS: org members read all of their org's properties. Layout has already
  // confirmed the user has at least one membership.
  const supabase = await createServerSupabaseClient();
  const { data: rawListings, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, status, title_en, title_es, city, price_cents, currency, image_count, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(50);

  if (error) {
    return (
      <main>
        <p role="alert" className="text-red-600">
          {error.message}
        </p>
      </main>
    );
  }

  const listings = (rawListings ?? []) as unknown as ListingRow[];
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

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
          {t('listingsHeading')}
        </h1>
        <a
          href={newListingPath}
          className="inline-flex h-9 items-center rounded-lg bg-surface-dark px-3 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
        >
          {t('newListing')}
        </a>
      </header>

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
          <a
            href={newListingPath}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
          >
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
                <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.city')}
                </th>
                <th className="px-3 py-2 text-right font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.price')}
                </th>
                <th className="px-3 py-2 text-right font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.images')}
                </th>
                <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                  {t('table.updated')}
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
                    <td className="px-3 py-2">
                      <a className="underline" href={editPathFor(row.id)}>
                        {title}
                      </a>
                      <span className="ml-2 text-xs text-helper">{row.short_id}</span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} label={tStatus(row.status)} />
                    </td>
                    <td className="px-3 py-2">{row.city}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPrice(Number(row.price_cents), row.currency, typedLocale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.image_count}</td>
                    <td className="px-3 py-2 text-helper">
                      {dateFormatter.format(new Date(row.updated_at))}
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
