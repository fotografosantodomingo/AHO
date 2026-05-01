import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import type { SearchListing } from '@/lib/listings/search';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserFavoriteIds } from '@/lib/listings/favorites';
import { ListingCard } from './listing-card';

interface Props {
  listings: SearchListing[];
  locale: Locale;
}

/**
 * Similar-homes carousel for /properties/[slug].
 *
 * Server Component — server-rendered grid. On md+ shows 3 columns; on
 * mobile horizontal-scrolling row (snap-x). Hides entirely when there
 * are no similar listings (honest emptiness — we don't widen the
 * similarity criteria to fill the band).
 */
export async function SimilarHomes({ listings, locale }: Props) {
  if (listings.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'property' });
  const approxLabels = await precomputeApproxLabels(
    listings.map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      currency: l.currency,
    })),
    locale,
  );

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const favoriteIds = await getUserFavoriteIds(
    supabase,
    userId,
    listings.map((l) => l.id),
  );

  return (
    <section
      aria-labelledby="similar-heading"
      className="mt-12"
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2
          id="similar-heading"
          className="font-brand text-xl font-semibold tracking-tight"
        >
          {t('similarHomesHeading')}
        </h2>
      </header>

      {/* On mobile: horizontal snap-scroll row of fixed-width cards.
          On md+: 3-column grid. Same data, two layouts. */}
      <ul className="-mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-2 md:gap-4 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
        {listings.map((listing) => (
          <li
            key={listing.id}
            className="w-72 shrink-0 snap-start md:w-auto md:shrink"
          >
            <ListingCard
              listing={listing}
              locale={locale}
              approxPriceLabel={approxLabels.get(listing.id) ?? null}
              favorited={favoriteIds.has(listing.id)}
              isAuthed={!!userId}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
