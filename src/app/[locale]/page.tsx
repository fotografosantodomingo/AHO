import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { searchListings } from '@/lib/listings/search';
import { ListingCard } from '@/components/listings/listing-card';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

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
  const tSite = await getTranslations({ locale, namespace: 'site' });
  const searchPath = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;

  // Featured = most recent active+published listings, ordered by featured_until then published_at.
  // searchListings already applies the right ordering and active+published filter.
  const featured = await searchListings(
    { q: null, city: null, transaction: null, minPrice: null, maxPrice: null, bedsMin: null, page: 1 },
    typedLocale,
  );

  // Structured data for the homepage. Two graphs:
  //   1. Organization (publisher info — Knowledge Panel eligibility for
  //      branded "AHO" / "Advertise Homes Online" searches).
  //   2. WebSite + SearchAction (lets Google surface a site-search box
  //      directly in the SERP for branded queries — sitelinks searchbox).
  // Per HANDOFF.md §16: structured data is part of the SEO baseline, and
  // the homepage is where these top-level graphs belong.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const homeUrl = `${site}/${locale}`;
  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: tSite('name'),
    alternateName: tSite('tagline'),
    url: homeUrl,
    description: tSite('description'),
    logo: `${site}/icon.svg`,
  };
  const websiteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: tSite('name'),
    url: homeUrl,
    inLanguage: locale === 'es' ? 'es' : 'en',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${site}${searchPath}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteLd) }}
      />
      {/* Hero. Surface-muted (#f1f2f3) in light, surface-deep (#0d0e12) in
          dark — a half-step away from the body so the section reads as a
          distinct band. Border uses the spec's translucent --color-border. */}
      <section className="border-b border-border bg-surface-muted dark:bg-surface-deep">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h1 className="font-brand text-4xl font-semibold tracking-tight md:text-[52px] md:leading-[1.19]">
            {t('heading')}
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted dark:text-ink-inverse-muted">
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
              className="block flex-1 rounded-lg border border-border-strong bg-surface px-4 py-2.5 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
            />
            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink"
            >
              {t('searchSubmit')}
            </button>
          </form>

          <div className="mt-5 flex gap-3 text-sm">
            <a
              href={searchPath}
              className="text-helper underline-offset-2 hover:underline"
            >
              {t('ctaForBuyers')}
            </a>
            <span className="text-border-strong/60" aria-hidden="true">
              ·
            </span>
            <a
              href={pricingPath}
              className="text-helper underline-offset-2 hover:underline"
            >
              {t('ctaForAgents')}
            </a>
          </div>
        </div>
      </section>

      {/* Featured listings. Section label uses the HashiCorp uppercase wayfinding pattern (13px / 600 / 1.3px tracking). */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('featuredHeading')}
        </p>

        {featured.listings.length === 0 ? (
          <p className="mt-4 text-sm text-helper">{t('featuredEmpty')}</p>
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
