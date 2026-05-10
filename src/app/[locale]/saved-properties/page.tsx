import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { fetchSavedProperties } from '@/lib/listings/favorites';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { ListingCard } from '@/components/listings/listing-card';
import { EmptyState } from '@/components/ui/empty-state';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

/**
 * /{locale}/saved-properties (paths: /en/saved-properties,
 * /es/inmuebles-guardados).
 *
 * Buyer-side dashboard view of favorited listings. Shows current saved
 * inventory only — favorites pointing at archived/sold/unpublished
 * listings are hidden but the row stays in DB so if the listing comes
 * back online, the favorite reappears.
 *
 * Auth: signed-in users only. Anonymous → redirect to /signin?next=…
 * (anyone with an account, not just agents — favorites are a buyer
 * feature; non-agents reach this directly without going through
 * /dashboard which would bounce them to /pricing).
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const t = await getTranslations({ locale, namespace: 'savedProperties' });
  return {
    title: t('heading'),
    description: t('subheading'),
    robots: { index: false, follow: false },
  };
}

export default async function SavedPropertiesPage({
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
    const here = localePath(typedLocale, '/saved-properties');
    const signinPath = localePath(typedLocale, '/signin');
    redirect(`${signinPath}?next=${encodeURIComponent(here)}`);
  }

  const t = await getTranslations({ locale, namespace: 'savedProperties' });
  const listings = await fetchSavedProperties(supabase, userResult.user.id);
  const browseHref = localePath(typedLocale, '/search');

  // Currency conversion + favorite set — every card on this page is
  // favorited by definition, so we can short-circuit the lookup.
  const approxLabels = await precomputeApproxLabels(
    listings.map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      currency: l.currency,
    })),
    typedLocale,
  );

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-12">
      <header className="space-y-2">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('heading')}
        </p>
        <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[40px] md:leading-[1.12]">
          {t('heading')}
        </h1>
        <p className="max-w-2xl text-sm text-ink-muted dark:text-ink-inverse-muted">
          {t('subheading')}
        </p>
      </header>

      {listings.length === 0 ? (
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((l) => (
            <li key={l.id}>
              <ListingCard
                listing={l}
                locale={typedLocale}
                approxPriceLabel={approxLabels.get(l.id) ?? null}
                favorited={true}
                isAuthed={true}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
