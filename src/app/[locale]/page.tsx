import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { searchListings } from '@/lib/listings/search';
import { getHomepageStats } from '@/lib/listings/stats';
import { ListingCard } from '@/components/listings/listing-card';
import { HeroSearchForm } from '@/components/home/hero-search-form';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';
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
  const tCountries = await getTranslations({ locale, namespace: 'countries' });
  const searchPath = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const pricingPath = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const countriesPath = `/${locale}/${locale === 'es' ? 'paises' : 'countries'}`;

  const [featured, stats] = await Promise.all([
    searchListings(
      {
        q: null,
        city: null,
        country: null,
        transaction: null,
        minPrice: null,
        maxPrice: null,
        bedsMin: null,
        page: 1,
      },
      typedLocale,
    ),
    getHomepageStats(),
  ]);

  const hasTrust = stats.activeListings > 0 || stats.cities > 0 || stats.verifiedAgents > 0;

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

      {/* Hero. Body in light mode is surface-muted, so this section has the
          same fill as the body. Visual definition comes from the dot-grid
          + glow + bottom border, not a contrasting background. In dark
          mode the section bg goes one shade deeper than body for a
          traditional band look. */}
      <section className="relative overflow-hidden border-b border-border dark:bg-surface-deep">
        <DotGrid ellipse="80% 60%" />
        <HeroGlow />

        <div className="relative mx-auto max-w-5xl px-6 py-20 md:py-28">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('eyebrow')}
          </p>
          <h1 className="mt-4 font-brand text-4xl font-semibold tracking-tight md:text-[56px] md:leading-[1.08]">
            {t('headingLead')}{' '}
            <span className="bg-gradient-to-r from-action to-action-active bg-clip-text text-transparent dark:from-action-dark dark:to-action-active">
              {t('headingAccent')}
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
            {t('leadCopy')}
          </p>

          <HeroSearchForm
            searchPath={searchPath}
            placeholder={t('searchPlaceholder')}
            submitLabel={t('searchSubmit')}
            tabAnyLabel={t('tabAny')}
            tabBuyLabel={t('tabBuy')}
            tabRentLabel={t('tabRent')}
          />

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <a
              href={searchPath}
              className="text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
            >
              {t('ctaForBuyers')}
            </a>
            <span className="text-border-strong/60" aria-hidden="true">
              ·
            </span>
            <a
              href={countriesPath}
              className="text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
            >
              {tCountries('heading')}
            </a>
            <span className="text-border-strong/60" aria-hidden="true">
              ·
            </span>
            <a
              href={pricingPath}
              className="text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
            >
              {t('ctaForAgents')}
            </a>
          </div>

          {/* Trust strip — only renders when at least one count > 0.
              Until the soft-beta agents land, this is hidden. Honest emptiness. */}
          {hasTrust && (
            <dl className="mt-12 grid max-w-2xl grid-cols-3 gap-6 border-t border-border pt-8">
              {([
                ['trustListingsLabel', stats.activeListings],
                ['trustCitiesLabel', stats.cities],
                ['trustAgentsLabel', stats.verifiedAgents],
              ] as const).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs uppercase tracking-wider text-helper">
                    {t(key)}
                  </dt>
                  <dd className="mt-1 font-brand text-2xl font-semibold tabular-nums">
                    {value.toLocaleString(locale === 'es' ? 'es-DO' : 'en-US')}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      {/* Featured listings. Section label uses the HashiCorp uppercase wayfinding pattern (13px / 600 / 1.3px tracking). */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="flex items-end justify-between">
          <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
            {t('featuredHeading')}
          </p>
          {featured.listings.length > 0 && (
            <a
              href={searchPath}
              className="text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
            >
              {t('viewAllListings')} →
            </a>
          )}
        </div>

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

      {/* How AHO works. Three-step explainer for visitors who arrive without
          context. Pure structural copy — no images, no fake testimonials.
          Borders + numbered chips keep it dense without feeling hollow. */}
      <section className="border-t border-border bg-surface dark:bg-surface-deep">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="font-brand text-3xl font-semibold tracking-tight md:text-[40px] md:leading-[1.15]">
            {t('howHeading')}
          </h2>
          <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted">
            {t('howSubheading')}
          </p>

          <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            {([1, 2, 3] as const).map((n) => (
              <li
                key={n}
                className="flex flex-col gap-3 rounded-card border border-border bg-surface-muted p-6 shadow-whisper dark:bg-surface-dark"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong/30 bg-surface font-brand text-sm font-semibold text-action shadow-whisper dark:bg-surface-deep dark:text-action-dark">
                  {n}
                </span>
                <h3 className="font-brand text-lg font-semibold tracking-tight">
                  {t(`howStep${n}Title` as 'howStep1Title')}
                </h3>
                <p className="text-sm leading-relaxed text-ink-muted dark:text-ink-inverse-muted">
                  {t(`howStep${n}Body` as 'howStep1Body')}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-10">
            <a
              href={pricingPath}
              className="inline-flex items-center rounded-lg bg-surface-dark px-5 py-2.5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink dark:bg-surface dark:text-ink dark:hover:bg-surface-muted"
            >
              {t('howCta')} →
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
