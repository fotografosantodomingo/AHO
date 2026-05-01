import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import type { SearchListing } from '@/lib/listings/search';
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
            <ListingCard listing={listing} locale={locale} />
          </li>
        ))}
      </ul>
    </section>
  );
}
