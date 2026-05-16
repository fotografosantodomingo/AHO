import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { searchListings } from '@/lib/listings/search';
import { getHomepageStats } from '@/lib/listings/stats';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { ListingCard } from '@/components/listings/listing-card';
import { HeroSearchForm } from '@/components/home/hero-search-form';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { publicEnv } from '@/lib/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserFavoriteIds } from '@/lib/listings/favorites';
import { RecentlyViewed } from '@/components/listings/recently-viewed';
import { ProAutomationSection } from '@/components/home/pro-automation-section';
import {
  buildOrganization,
  buildWebSite,
  serializeJsonLd,
} from '@/lib/seo/jsonld';

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
  const searchPath = localePath(typedLocale, '/search');
  const pricingPath = localePath(typedLocale, '/pricing');
  // City-landing route stem per locale. The hero form appends
  // `/{country}/{city}` after this string when both are selected
  // (#31). Derived from the `/properties-in/[country]` PATHNAMES
  // entry by stripping the param tail — keeps a single source of
  // truth (PATHNAMES) for the localized segment.
  const cityLandingStem = localePath(typedLocale, '/properties-in/[country]').replace(
    '/[country]',
    '',
  );

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

  // Precompute approx-converted prices for the featured listings (single
  // rate fetch; absent map means no-conversion needed or unavailable).
  const approxLabels = await precomputeApproxLabels(
    featured.listings.slice(0, 6).map((l) => ({
      id: l.id,
      priceCents: l.priceCents,
      currency: l.currency,
    })),
    typedLocale,
  );

  // Pre-resolve the buyer's favorite set so the heart on each card
  // renders in the correct state on first paint (one query, six cards).
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const visibleIds = featured.listings.slice(0, 6).map((l) => l.id);
  const favoriteIds = await getUserFavoriteIds(supabase, userId, visibleIds);

  // Structured data for the homepage. Two graphs:
  //   1. Organization (publisher info — Knowledge Panel eligibility for
  //      branded "AHO" / "Advertise Homes Online" searches).
  //   2. WebSite + SearchAction (lets Google surface a site-search box
  //      directly in the SERP for branded queries — sitelinks searchbox).
  // Per HANDOFF.md §16: structured data is part of the SEO baseline, and
  // the homepage is where these top-level graphs belong. We deliberately
  // do NOT emit a 1-crumb BreadcrumbList — the homepage is the root, and
  // a BreadcrumbList of length 1 reads as a SERP misconfiguration to
  // crawlers. Country / city pages emit the full crumb chain instead.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const homeUrl = `${site}/${locale}`;
  const organizationLd = buildOrganization({
    name: tSite('name'),
    alternateName: tSite('tagline'),
    url: homeUrl,
    description: tSite('description'),
    logo: `${site}/icon.png`,
  });
  const websiteLd = buildWebSite({
    name: tSite('name'),
    url: homeUrl,
    inLanguage: locale === 'es' ? 'es' : 'en',
    searchUrlTemplate: `${site}${searchPath}?q={search_term_string}`,
  });

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(organizationLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(websiteLd) }}
      />

      {/* Hero. Body bg in BOTH modes (light: surface-muted; dark:
          surface-dark). No section-band fill — visual definition
          comes from the dot-grid + glow + bottom border. Fixed in
          batch DP: previously had `dark:bg-surface-deep` which made
          the hero a banded section in dark mode but a flat section
          in light mode (asymmetric mismatch). Now consistent. */}
      <section className="relative overflow-hidden border-b border-border">
        <DotGrid ellipse="80% 60%" />
        <HeroGlow />

        <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28">
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
            locale={typedLocale}
            searchPath={searchPath}
            cityLandingStem={cityLandingStem}
            agentPath={pricingPath}
            submitLabel={t('searchSubmit')}
            tabBuyLabel={t('tabBuy')}
            tabRentLabel={t('tabRent')}
            agentLinkLabel={t('ctaForAgents')}
            countryPlaceholder={t('selectCountry')}
            cityPlaceholder={t('selectCity')}
            cityDisabledPlaceholder={t('selectCityDisabled')}
            cityLoadingPlaceholder={t('loadingCities')}
          />

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
      <section className="mx-auto max-w-6xl px-6 py-16">
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
          // Honest emptiness — until soft-beta agents land, the featured
          // grid has nothing real to show. Use the shared EmptyState
          // component (dashed border, centered) so the section reads
          // intentionally empty instead of as a broken page that lost
          // its content. CLAUDE.md hard rule #8.
          <div className="mt-6">
            <EmptyState
              heading={t('featuredEmpty')}
              body={t('featuredEmptyBody')}
              primaryCta={
                <a href={searchPath} className="btn-secondary">
                  {t('browseByCity')}
                </a>
              }
              secondaryCta={
                <a href={pricingPath} className="btn-primary">
                  {t('listYourFirstProperty')}
                </a>
              }
            />
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.listings.slice(0, 6).map((l) => (
              <li key={l.id}>
                <ListingCard
                  listing={l}
                  locale={typedLocale}
                  approxPriceLabel={approxLabels.get(l.id) ?? null}
                  favorited={favoriteIds.has(l.id)}
                  isAuthed={!!userId}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently viewed rail (feat/recently-viewed). Self-hides when
          the visitor has no view history yet. */}
      <section className="mx-auto max-w-6xl px-6 pb-4">
        <RecentlyViewed locale={typedLocale} />
      </section>

      {/* Pro Automation sales section — Phase 2 of the social-distribution
          spec. Always-dark forest-green band (matches the Pro Automation
          locked-state UI on /pricing) so visitors see the marquee feature
          before reaching the pricing-CTA at the bottom. */}
      <ProAutomationSection pricingPath={pricingPath} locale={locale} />

      {/* How AHO works. Three-step explainer. Cards use the standard
          `card-base` (bg-surface light / bg-surface-deep dark) so they
          lift from the muted body bg without an extra section band —
          previously this section had its own banding which created a
          light/dark asymmetry the rest of the page didn't share. */}
      <section className="border-t border-border">
        <div className="section-pad">
          <h2 className="font-brand text-3xl font-semibold tracking-tight md:text-[40px] md:leading-[1.15]">
            {t('howHeading')}
          </h2>
          <p className="mt-4 max-w-2xl text-base text-ink-muted dark:text-ink-inverse-muted">
            {t('howSubheading')}
          </p>

          <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            {([1, 2, 3] as const).map((n) => (
              <li key={n} className="card-base flex flex-col gap-3 p-6">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong/30 bg-surface-muted font-brand text-sm font-semibold text-action shadow-whisper dark:bg-surface-dark dark:text-action-dark">
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
            <a href={pricingPath} className="btn-primary">
              {t('howCta')} →
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
