import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { fetchAgentProfile } from '@/lib/listings/search';
import { fetchPublishedReviewsForAgent } from '@/lib/reviews/queries';
import { precomputeApproxLabels } from '@/lib/currency/server';
import { ListingCard } from '@/components/listings/listing-card';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';
import { ReviewsSection } from '@/components/reviews/reviews-section';
import { publicEnv } from '@/lib/env';
import { getCountryName } from '@/lib/i18n/countries';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getUserFavoriteIds } from '@/lib/listings/favorites';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
  slug: string;
}

/**
 * Public agent / org profile page at:
 *   EN  /en/agents/{slug}
 *   ES  /es/agentes/{slug}
 *
 * The slug is `organizations.slug` (set at signup; immutable). We refuse
 * to surface RLS test fixtures (slugs starting `aho-test-org-`) per
 * CLAUDE.md hard rule #8 — the helper short-circuits to `org: null` for
 * those, which we render as a 404 here.
 *
 * Schema.org annotation: `@type: "RealEstateAgent"` (single-agent orgs)
 * or `"Organization"` (agency/expert) so Google understands what surfaces
 * to surface in the Knowledge Panel for branded searches.
 */


export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) return {};
  const typedLocale = locale as Locale;

  const result = await fetchAgentProfile({ orgSlug: slug, locale: typedLocale });
  if (!result.org) {
    return {
      title: 'Agent not found',
      robots: { index: false, follow: false },
    };
  }

  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  // Canonical always points at the SEO-friendly public_slug when the
  // org has one, even if the visitor arrived via the legacy slug.
  // Search engines follow the canonical and consolidate ranking on
  // the public_slug URL.
  const canonicalSlug = result.org.publicSlug ?? slug;
  const enPath = `/en/agents/${canonicalSlug}`;
  const esPath = `/es/agentes/${canonicalSlug}`;
  const canonical = typedLocale === 'es' ? `${site}${esPath}` : `${site}${enPath}`;

  const description =
    (typedLocale === 'es' ? result.org.descriptionEs : result.org.descriptionEn) ??
    result.org.descriptionEn ??
    result.org.descriptionEs ??
    `${result.org.name} — real estate listings on AHO`;

  return {
    title: result.org.name,
    description,
    alternates: {
      canonical,
      languages: {
        en: `${site}${enPath}`,
        es: `${site}${esPath}`,
        'x-default': `${site}${enPath}`,
      },
    },
    openGraph: {
      type: 'profile',
      url: canonical,
      title: result.org.name,
      description,
      ...(result.org.logoUrl ? { images: [{ url: result.org.logoUrl }] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

export default async function AgentProfilePage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) notFound();
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const result = await fetchAgentProfile({ orgSlug: slug, locale: typedLocale });
  if (!result.org) notFound();

  // Legacy-slug redirect: if the visitor used the auto-generated org
  // slug AND the org now has a public_slug, send them to the canonical
  // SEO URL with a 301-equivalent redirect. Search engines consolidate
  // and humans see the readable URL in their address bar.
  if (result.org.publicSlug && slug !== result.org.publicSlug) {
    const pathSeg = typedLocale === 'es' ? 'agentes' : 'agents';
    redirect(`/${typedLocale}/${pathSeg}/${result.org.publicSlug}`);
  }

  const t = await getTranslations({ locale, namespace: 'agentProfile' });

  // Reviews — only fetch when we have an agent userId. The section
  // renders a "no reviews yet" empty state when count is 0.
  const reviewsData = result.agent
    ? await fetchPublishedReviewsForAgent({ agentId: result.agent.userId, limit: 20 })
    : { reviews: [], aggregate: { count: 0, avg: 0 } };

  // Precompute approx-converted price labels across BOTH active listings
  // and the recent-sales carousel. Single rate fetch.
  const approxLabels = await precomputeApproxLabels(
    [
      ...result.listings.map((l) => ({
        id: l.id,
        priceCents: l.priceCents,
        currency: l.currency,
      })),
      ...result.soldListings.map((l) => ({
        id: l.id,
        priceCents: l.priceCents,
        currency: l.currency,
      })),
    ],
    typedLocale,
  );

  // Favorites pre-resolved across active listings only — sold ones don't
  // get a heart (they're historical records, not save-able inventory).
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult.user?.id ?? null;
  const favoriteIds = await getUserFavoriteIds(
    supabase,
    userId,
    result.listings.map((l) => l.id),
  );

  const description =
    (typedLocale === 'es' ? result.org.descriptionEs : result.org.descriptionEn) ??
    result.org.descriptionEn ??
    result.org.descriptionEs;

  // Location strap — "City, Country" if both, "Country" if only country.
  const country = result.org.headquartersCountry
    ? getCountryName(result.org.headquartersCountry, typedLocale)
    : null;
  const location = [result.org.headquartersCity, country].filter(Boolean).join(', ');
  const subheading = location
    ? t('subheadingTemplate', { location })
    : t('subheadingNoLocation');

  const browseAllHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}`;

  // JSON-LD: schema.org RealEstateAgent for agent-tier orgs, Organization
  // for agency/expert. Both inherit name + description + url + sameAs.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  // Canonical URL for the JSON-LD `url` field — always the public_slug
  // when present, falling back to the legacy slug. (At this point in
  // the function the legacy-slug visitor was already redirected, so
  // `slug` here is the canonical form, but the explicit `??` keeps it
  // robust if the redirect path ever changes.)
  const canonicalSlug = result.org.publicSlug ?? slug;
  const profileUrl = `${site}/${locale}/${
    typedLocale === 'es' ? 'agentes' : 'agents'
  }/${canonicalSlug}`;
  // Build sameAs[] from all surfaced socials so search engines can
  // confidently knit the Knowledge Panel together. Empty array stays
  // omitted because schema.org rejects sameAs:[].
  const socialLinks = [
    result.org.website,
    result.agent?.facebookUrl,
    result.agent?.instagramUrl,
    result.agent?.linkedinUrl,
  ].filter((u): u is string => !!u);
  // Image array — logo + agent avatar gives Google two distinct
  // images to consider for the Knowledge Panel thumbnail. schema.org
  // accepts a string or an array; array is richer.
  const images = [result.org.logoUrl, result.agent?.avatarUrl].filter(
    (u): u is string => !!u,
  );

  // priceRange — derived from the agent's sales-stats price range,
  // formatted in the agent's primary currency. Schema.org expects a
  // string like "$$$" or a localized range. We emit the explicit USD
  // range when we have it (richer signal than the abstract "$$$"
  // notation; Google reads both).
  const priceMin = result.agent?.statsPriceMinCents;
  const priceMax = result.agent?.statsPriceMaxCents;
  const priceRange =
    priceMin != null && priceMax != null && priceMax >= priceMin
      ? `${formatRangePrice(priceMin)} - ${formatRangePrice(priceMax)}`
      : null;

  // WhatsApp phone is already exposed in the UI as a click-to-chat
  // link, so emitting it as `telephone` doesn't widen the privacy
  // surface — it just lets Google attach it to the rich result.
  const telephone = result.agent?.whatsappPhone;

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': result.org.type === 'agent' ? 'RealEstateAgent' : 'Organization',
    name: result.org.name,
    url: profileUrl,
    ...(description ? { description } : {}),
    ...(socialLinks.length > 0 ? { sameAs: socialLinks } : {}),
    ...(images.length > 0 ? { image: images.length === 1 ? images[0] : images } : {}),
    ...(priceRange ? { priceRange } : {}),
    ...(telephone ? { telephone } : {}),
    ...(result.agent?.specialties.length
      ? { knowsAbout: result.agent.specialties }
      : {}),
    ...(result.agent?.languagesSpoken.length
      ? { knowsLanguage: result.agent.languagesSpoken }
      : {}),
    // areaServed[]: each distinct (city, country) tuple becomes a Place
    // node so Google understands the agent's geographic coverage.
    ...(result.areasServed.length > 0
      ? {
          areaServed: result.areasServed.map((a) => ({
            '@type': 'Place',
            name: `${a.city}, ${getCountryName(a.countryCode, typedLocale)}`,
            address: {
              '@type': 'PostalAddress',
              addressLocality: a.city,
              addressCountry: a.countryCode,
            },
          })),
        }
      : {}),
    ...(result.org.headquartersCity || result.org.headquartersCountry
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(result.org.headquartersCity
              ? { addressLocality: result.org.headquartersCity }
              : {}),
            ...(result.org.headquartersCountry
              ? { addressCountry: result.org.headquartersCountry }
              : {}),
          },
        }
      : {}),
  };

  // BreadcrumbList JSON-LD — Home > Agents (directory) > {Name}.
  // Separate node from the agent JSON-LD so each tracks its own validity.
  const agentsDirHref = `${site}/${locale}/${typedLocale === 'es' ? 'agentes' : 'agents'}`;
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: typedLocale === 'es' ? 'Inicio' : 'Home',
        item: `${site}/${locale}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: typedLocale === 'es' ? 'Agentes' : 'Agents',
        item: agentsDirHref,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: result.org.name,
        item: profileUrl,
      },
    ],
  };

  // FAQPage JSON-LD — only when we have at least one published FAQ.
  // Empty FAQPage is invalid per Google's docs (mainEntity must be ≥1).
  const faqJsonLd =
    result.faqs.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: result.faqs.map((f) => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: {
              '@type': 'Answer',
              text: f.answer,
            },
          })),
        }
      : null;

  // AggregateRating JSON-LD — REQUIRED by schema.org to omit when count
  // is 0 (otherwise Google flags it as invalid). Per the privacy/JSON-LD
  // audit: conditional rendering is the documented rule.
  if (reviewsData.aggregate.count > 0) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: reviewsData.aggregate.avg,
      reviewCount: reviewsData.aggregate.count,
      bestRating: 5,
      worstRating: 1,
    };
    // Embed up to 5 most recent reviews as Review nodes for richer SERP.
    jsonLd.review = reviewsData.reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      reviewRating: {
        '@type': 'Rating',
        ratingValue: r.rating,
        bestRating: 5,
        worstRating: 1,
      },
      author: { '@type': 'Person', name: r.reviewerName || 'Reviewer' },
      reviewBody: r.body,
      datePublished: r.createdAt,
    }));
  }

  // Initials fallback for the logo placeholder. Two-character max.
  const initials = result.org.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  // Org-type label for the eyebrow row. The schema-org @type is already
  // narrower; this is just the user-facing tag.
  const orgTypeLabel =
    result.org.type === 'agency'
      ? typedLocale === 'es'
        ? 'Agencia inmobiliaria'
        : 'Real estate agency'
      : result.org.type === 'expert'
      ? typedLocale === 'es'
        ? 'Experto verificado'
        : 'Verified expert'
      : typedLocale === 'es'
      ? 'Agente inmobiliario'
      : 'Real estate agent';

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {faqJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
        />
      )}
      <main>
        {/* Hero band — dot-grid + glow, logo or initials chip on the seam. */}
        <section className="relative overflow-hidden border-b border-border">
          <DotGrid />
          <HeroGlow />
          <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-14 md:pb-20 md:pt-16">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {orgTypeLabel}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              {/* Hero photo: prefer the org logo when set, else the agent's
                  own profile avatar. For solo agents (most of AHO) the
                  organization is them — they upload a profile photo via
                  /dashboard/profile, never bother to upload a separate org
                  logo, and end up with an initials placeholder. Falling
                  back to agent.avatarUrl gives them what they expected. */}
              {(result.org.logoUrl || result.agent?.avatarUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.org.logoUrl ?? result.agent!.avatarUrl!}
                  alt={
                    result.org.logoUrl
                      ? `${result.org.name} logo`
                      : result.agent?.fullName ?? result.org.name
                  }
                  width={80}
                  height={80}
                  className="h-20 w-20 rounded-card border border-border bg-surface object-cover shadow-whisper dark:bg-surface-dark"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-20 w-20 items-center justify-center rounded-card border border-border bg-surface font-brand text-2xl font-semibold tracking-tight text-action shadow-whisper dark:bg-surface-dark dark:text-action-dark"
                >
                  {initials || '·'}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[42px] md:leading-[1.12]">
                  {result.org.name}
                </h1>
                <p className="mt-1.5 text-sm text-helper">{subheading}</p>
              </div>
            </div>
            {description && (
              <p className="mt-6 max-w-3xl text-base text-ink-muted dark:text-ink-inverse-muted">
                {description}
              </p>
            )}
            {(result.agent?.specialties.length || result.agent?.languagesSpoken.length) && (
              <div className="mt-5 flex flex-wrap gap-2">
                {result.agent?.specialties.map((s) => (
                  <span
                    key={`spec-${s}`}
                    className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-ink shadow-whisper dark:bg-surface-deep dark:text-ink-inverse"
                  >
                    {s}
                  </span>
                ))}
                {result.agent?.languagesSpoken.map((l) => (
                  <span
                    key={`lang-${l}`}
                    className="inline-flex items-center rounded-full bg-emerald-100/70 px-3 py-1 text-xs font-medium text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100"
                  >
                    {l}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {result.agent?.whatsappPhone && (
                <a
                  href={`https://wa.me/${result.agent.whatsappPhone.replace(/\D/g, '')}?text=${encodeURIComponent(
                    typedLocale === 'es'
                      ? `Hola ${result.agent.fullName ?? result.org.name}, vi tu perfil en AHO y me gustaría saber más.`
                      : `Hi ${result.agent.fullName ?? result.org.name}, I saw your profile on AHO and would like to know more.`,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700"
                >
                  {t('whatsappCta')}
                </a>
              )}
              {result.org.website && (
                <a
                  href={result.org.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
                >
                  {t('websiteCta')} →
                </a>
              )}
              {result.agent?.linkedinUrl && (
                <a
                  href={result.agent.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
                >
                  LinkedIn →
                </a>
              )}
              {result.agent?.instagramUrl && (
                <a
                  href={result.agent.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
                >
                  Instagram →
                </a>
              )}
              {result.agent?.facebookUrl && (
                <a
                  href={result.agent.facebookUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
                >
                  Facebook →
                </a>
              )}
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl space-y-10 px-6 py-12">

        {/* Long-form bio. Whitespace-preserved (whitespace-pre-line) so
            agents can use simple line breaks without learning Markdown.
            Hero already shows the org description (which may be the same
            text); this is the agent's personal bio from the profiles
            row. Hidden when empty rather than rendering "About me" with
            no content. */}
        {result.agent?.bio && (
          <section aria-labelledby="bio-heading" className="space-y-3">
            <h2
              id="bio-heading"
              className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
            >
              {t('bioHeading')}
            </h2>
            <p className="max-w-3xl whitespace-pre-line text-base text-ink-muted dark:text-ink-inverse-muted">
              {result.agent.bio}
            </p>
          </section>
        )}

        {/* Stat tiles. Em-dash for missing values (locked decision per
            the dev review — clearer than 0 for "we don't have data yet").
            Whole row hidden if every metric is null/zero — empty agents
            don't need a row of em-dashes screaming "no data". */}
        {result.agent && (result.agent.statsTotalSales > 0 || result.agent.statsSales12mo > 0) && (
          <section aria-label={t('statsLabel')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label={t('statSales12mo')}
              value={result.agent.statsSales12mo > 0 ? String(result.agent.statsSales12mo) : '—'}
            />
            <StatTile
              label={t('statTotalSales')}
              value={result.agent.statsTotalSales > 0 ? String(result.agent.statsTotalSales) : '—'}
            />
            <StatTile
              label={t('statPriceRange')}
              value={
                result.agent.statsPriceMinCents != null && result.agent.statsPriceMaxCents != null
                  ? `${formatStatPrice(result.agent.statsPriceMinCents, typedLocale)}–${formatStatPrice(result.agent.statsPriceMaxCents, typedLocale)}`
                  : '—'
              }
            />
            <StatTile
              label={t('statAvgPrice')}
              value={
                result.agent.statsAvgPriceCents != null
                  ? formatStatPrice(result.agent.statsAvgPriceCents, typedLocale)
                  : '—'
              }
            />
          </section>
        )}

        {/* Recent Sales carousel. Hidden entirely if zero sold listings
            (no empty-state copy — empty rail looks broken). Horizontal
            scroll on mobile; grid on md+. */}
        {result.soldListings.length > 0 && (
          <section aria-labelledby="recent-sales-heading" className="space-y-3">
            <h2
              id="recent-sales-heading"
              className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
            >
              {t('recentSalesHeading')}
            </h2>
            <ul className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2 md:grid md:grid-cols-3 md:overflow-x-visible lg:grid-cols-4">
              {result.soldListings.slice(0, 8).map((l) => (
                <li key={l.id} className="w-64 shrink-0 md:w-auto">
                  <ListingCard
                    listing={l}
                    locale={typedLocale}
                    approxPriceLabel={approxLabels.get(l.id) ?? null}
                  />
                  <p className="mt-1 px-1 text-[11px] uppercase tracking-wider text-helper">
                    {l.transactionType === 'rent' || l.transactionType === 'short_term'
                      ? t('soldRented')
                      : t('soldSold')}
                    {l.soldDate && (
                      <> · {new Intl.DateTimeFormat(typedLocale === 'es' ? 'es-DO' : 'en-US', { month: 'short', year: 'numeric' }).format(new Date(l.soldDate))}</>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="listings-heading" className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2
              id="listings-heading"
              className="font-brand text-xl font-bold tracking-tight"
            >
              {t('listingsHeading')}
            </h2>
            {result.totalShown > 0 && (
              <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                {t(
                  result.totalShown === 1 ? 'listingsCount_one' : 'listingsCount_other',
                  { count: result.totalShown },
                )}
              </p>
            )}
          </div>

          {result.listings.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-strong/60 p-12 text-center">
              <h3 className="font-brand text-lg font-bold">{t('emptyHeading')}</h3>
              <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted dark:text-ink-inverse-muted">
                {t('emptyBody', { name: result.org.name })}
              </p>
              <Link
                href={browseAllHref}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-border-strong px-5 text-sm font-medium transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                {t('browseAllCta')}
              </Link>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.listings.map((l) => (
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

        {/* Sold listings table — only renders when the agent has at
            least one closing. Tabular layout (not card grid) because
            the closing-side + closing-date matter for the sold record
            and a card hides them. */}
        {result.soldListings.length > 0 && (
          <section aria-labelledby="sold-heading" className="space-y-3">
            <h2
              id="sold-heading"
              className="font-brand text-xl font-bold tracking-tight"
            >
              {t('soldHeading')}
            </h2>
            <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-left">
                  <tr>
                    <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {t('soldColAddress')}
                    </th>
                    <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {t('soldColDate')}
                    </th>
                    <th className="px-3 py-2 text-right font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {t('soldColPrice')}
                    </th>
                    <th className="px-3 py-2 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                      {t('soldColSide')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result.soldListings.map((l) => {
                    const slug = (typedLocale === 'es' ? l.slugEs : l.slugEn) ?? l.slugEn ?? l.slugEs;
                    const titleStr =
                      (typedLocale === 'es' ? l.titleEs : l.titleEn) ?? l.titleEn ?? l.titleEs ?? '—';
                    const path = slug
                      ? `/${typedLocale}/${typedLocale === 'es' ? 'propiedades' : 'properties'}/${slug}-${l.shortId}`
                      : null;
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-2">
                          {path ? (
                            <Link className="hover:underline" href={path}>
                              {titleStr}
                            </Link>
                          ) : (
                            titleStr
                          )}
                          <div className="text-xs text-helper">
                            {l.city}, {getCountryName(l.countryCode, typedLocale)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-helper">
                          {l.soldDate
                            ? new Intl.DateTimeFormat(typedLocale === 'es' ? 'es-DO' : 'en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              }).format(new Date(l.soldDate))
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.soldPriceCents != null
                            ? formatStatPrice(l.soldPriceCents, typedLocale, l.currency)
                            : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {l.representedSide === 'buyer'
                            ? t('sideBuyer')
                            : l.representedSide === 'seller'
                            ? t('sideSeller')
                            : l.representedSide === 'both'
                            ? t('sideBoth')
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Areas served — derived from listing cities, not user-entered.
            Hidden when there's nothing to show. */}
        {result.areasServed.length > 0 && (
          <section aria-labelledby="areas-heading" className="space-y-3">
            <h2
              id="areas-heading"
              className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper"
            >
              {t('areasServedHeading')}
            </h2>
            <ul className="flex flex-wrap gap-2">
              {result.areasServed.map((a) => (
                <li
                  key={`${a.countryCode}-${a.city}`}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-sm shadow-whisper dark:bg-surface-deep"
                >
                  <span className="font-medium">{a.city}</span>
                  <span className="text-helper">·</span>
                  <span className="text-helper">{getCountryName(a.countryCode, typedLocale)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* FAQ — uses native <details> so keyboard nav + screen readers
            work without extra script. JSON-LD is emitted at the top of
            the page; rendering verbatim keeps SERP rich-snippets aligned
            with the visible text per Google's policy. Hidden entirely if
            the agent hasn't published any FAQs in the active locale. */}
        {result.faqs.length > 0 && (
          <section aria-labelledby="faq-heading" className="space-y-3">
            <h2
              id="faq-heading"
              className="font-brand text-xl font-bold tracking-tight"
            >
              {t('faqHeading')}
            </h2>
            <div className="divide-y divide-border rounded-card border border-border bg-surface shadow-whisper dark:bg-surface-deep">
              {result.faqs.map((f) => (
                <details key={f.id} className="group px-4 py-3">
                  <summary className="cursor-pointer list-none font-medium leading-snug marker:hidden">
                    <span className="mr-2 inline-block transition-transform group-open:rotate-90 text-helper">›</span>
                    {f.question}
                  </summary>
                  <div className="mt-2 whitespace-pre-line text-sm text-ink-muted dark:text-ink-inverse-muted">
                    {f.answer}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* Reviews — agent-targeted; rendered only when we have an agent
            user_id (org with no owner row is a fixture edge case). The
            section itself handles the empty state honestly. */}
        {result.agent && (
          <ReviewsSection
            agentId={result.agent.userId}
            reviews={reviewsData.reviews}
            aggregateCount={reviewsData.aggregate.count}
            aggregateAvg={reviewsData.aggregate.avg}
          />
        )}
        </div>
      </main>
    </>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-whisper dark:bg-surface-deep">
      <p className="text-[11px] uppercase tracking-wider text-helper">{label}</p>
      <p className="mt-1 font-brand text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function formatStatPrice(cents: number, locale: string, currency = 'USD'): string {
  return new Intl.NumberFormat(locale === 'es' ? 'es-DO' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Locale-agnostic USD-formatted price for the schema.org `priceRange`
 * field. Always en-US so the JSON-LD reads cleanly to crawlers
 * regardless of which locale the page renders in.
 */
function formatRangePrice(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
