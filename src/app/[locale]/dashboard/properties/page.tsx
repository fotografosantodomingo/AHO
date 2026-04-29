import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { formatPrice } from '@/lib/listings/seo';

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
        <h1 className="text-2xl font-semibold tracking-tight">{t('listingsHeading')}</h1>
        <a
          href={newListingPath}
          className="inline-flex h-9 items-center rounded-md bg-zinc-900 px-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t('newListing')}
        </a>
      </header>

      {listings.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          <p>{t('listingsEmpty')}</p>
          <a
            href={newListingPath}
            className="mt-4 inline-flex h-9 items-center rounded-md bg-zinc-900 px-3 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t('listingsEmptyCta')}
          </a>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <thead className="text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-3 py-2">{t('table.title')}</th>
                <th className="px-3 py-2">{t('table.status')}</th>
                <th className="px-3 py-2">{t('table.city')}</th>
                <th className="px-3 py-2 text-right">{t('table.price')}</th>
                <th className="px-3 py-2 text-right">{t('table.images')}</th>
                <th className="px-3 py-2">{t('table.updated')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {listings.map((row) => {
                const title =
                  (typedLocale === 'es' ? row.title_es : row.title_en) ??
                  row.title_en ??
                  row.title_es ??
                  '—';
                return (
                  <tr key={row.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-3 py-2">
                      <a className="underline" href={editPathFor(row.id)}>
                        {title}
                      </a>
                      <span className="ml-2 text-xs text-zinc-500">{row.short_id}</span>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} label={tStatus(row.status)} />
                    </td>
                    <td className="px-3 py-2">{row.city}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatPrice(Number(row.price_cents), row.currency, typedLocale)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.image_count}</td>
                    <td className="px-3 py-2 text-zinc-500">
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
        return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';
      case 'pending':
        return 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200';
      case 'sold':
      case 'rented':
        return 'bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200';
      case 'archived':
      default:
        return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400';
    }
  })();
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}
