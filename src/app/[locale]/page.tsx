import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { searchListings } from '@/lib/listings/search';
import { ListingCard } from '@/components/listings/listing-card';

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const t = await getTranslations({ locale, namespace: 'home' });
  const searchPath = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;

  // Featured = most recent active+published listings, ordered by featured_until then published_at.
  // searchListings already applies the right ordering and active+published filter.
  const featured = await searchListings(
    { q: null, city: null, transaction: null, minPrice: null, maxPrice: null, bedsMin: null, page: 1 },
    typedLocale,
  );

  return (
    <main>
      {/* Hero */}
      <section className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{t('heading')}</h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
            {t('leadCopy')}
          </p>

          <form
            method="get"
            action={searchPath}
            role="search"
            className="mt-8 flex max-w-xl gap-2"
          >
            <input
              type="search"
              name="q"
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="block flex-1 rounded-md border border-zinc-300 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100"
            />
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-zinc-900 px-5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {t('searchSubmit')}
            </button>
          </form>

          <div className="mt-4 flex gap-3 text-sm">
            <a
              href={searchPath}
              className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              {t('ctaForBuyers')}
            </a>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <a
              href={pricingPath}
              className="text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400"
            >
              {t('ctaForAgents')}
            </a>
          </div>
        </div>
      </section>

      {/* Featured listings */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-xl font-semibold tracking-tight">{t('featuredHeading')}</h2>

        {featured.listings.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t('featuredEmpty')}</p>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.listings.slice(0, 6).map((l) => (
              <li key={l.id}>
                <ListingCard listing={l} locale={typedLocale} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
