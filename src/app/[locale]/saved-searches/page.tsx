import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { SavedSearchRow } from '@/components/saved-searches/saved-search-row';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * Buyer-side "my saved searches" page. Anyone with a signed-in profile
 * can land here — agent subscription not required (the dashboard layout
 * bounces unsubbed users to /pricing, but this surface is open to all
 * registered users).
 *
 * Email-alert worker is OUT of scope until the Brevo transactional
 * sender is wired into a scheduled cron; today the saved searches are
 * revisit-bookmarks only. The `notify_email` column persists the
 * user's preference so the worker just turns on once it's deployed.
 *
 * Robots: noindex,nofollow (auth-gated; not a public surface).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'savedSearches' });
  return {
    title: `${t('heading')} · AHO`,
    robots: { index: false, follow: false },
  };
}

interface SavedSearchRowData {
  id: string;
  name: string | null;
  filters: Record<string, unknown>;
  locale: string;
  notify_email: boolean;
  created_at: string;
}

export default async function SavedSearchesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    redirect(
      `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}?next=${encodeURIComponent(
        `/${locale}/${locale === 'es' ? 'busquedas-guardadas' : 'saved-searches'}`,
      )}`,
    );
  }

  const { data: rows, error } = await supabase
    .from('saved_searches')
    .select('id, name, filters, locale, notify_email, created_at')
    .order('created_at', { ascending: false });

  const t = await getTranslations({ locale, namespace: 'savedSearches' });
  const browseHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}`;

  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-brand text-2xl font-semibold">{t('heading')}</h1>
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error.message}
        </p>
      </main>
    );
  }

  const searches = (rows ?? []) as unknown as SavedSearchRowData[];

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <header className="space-y-3">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('yourAccountEyebrow')}
        </p>
        <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[34px] md:leading-[1.18]">
          {t('heading')}
        </h1>
        <div className="inline-flex items-center gap-2 rounded-md border border-warn/30 bg-warn-bg/50 px-3 py-1.5 text-xs text-warn">
          <span aria-hidden="true">⚠</span>
          <span>{t('alertsBlocked')}</span>
        </div>
      </header>

      {searches.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong/60 bg-surface p-10 text-center shadow-whisper dark:bg-surface-deep">
          <p className="font-brand text-base font-semibold">{t('empty')}</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-helper">
            {t('emptyHint')}
          </p>
          <a
            href={browseHref}
            className="btn-primary mt-6"
          >
            {t('browseCta')}
          </a>
        </div>
      ) : (
        <ul className="space-y-3">
          {searches.map((s) => (
            <SavedSearchRow
              key={s.id}
              id={s.id}
              name={s.name}
              filters={s.filters}
              notifyEmail={s.notify_email}
              createdAt={s.created_at}
              locale={typedLocale}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
