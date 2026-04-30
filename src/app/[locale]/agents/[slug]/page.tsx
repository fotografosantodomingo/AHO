import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { fetchAgentProfile } from '@/lib/listings/search';
import { ListingCard } from '@/components/listings/listing-card';
import { DotGrid, HeroGlow } from '@/components/ui/dot-grid';
import { publicEnv } from '@/lib/env';

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

function resolveCountryName(countryCode: string, locale: Locale): string {
  try {
    const display = new Intl.DisplayNames([locale === 'es' ? 'es-DO' : 'en-US'], {
      type: 'region',
    });
    return display.of(countryCode.toUpperCase()) ?? countryCode.toUpperCase();
  } catch {
    return countryCode.toUpperCase();
  }
}

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
  const enPath = `/en/agents/${slug}`;
  const esPath = `/es/agentes/${slug}`;
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

  const t = await getTranslations({ locale, namespace: 'agentProfile' });

  const description =
    (typedLocale === 'es' ? result.org.descriptionEs : result.org.descriptionEn) ??
    result.org.descriptionEn ??
    result.org.descriptionEs;

  // Location strap — "City, Country" if both, "Country" if only country.
  const country = result.org.headquartersCountry
    ? resolveCountryName(result.org.headquartersCountry, typedLocale)
    : null;
  const location = [result.org.headquartersCity, country].filter(Boolean).join(', ');
  const subheading = location
    ? t('subheadingTemplate', { location })
    : t('subheadingNoLocation');

  const browseAllHref = `/${locale}/${typedLocale === 'es' ? 'buscar' : 'search'}`;

  // JSON-LD: schema.org RealEstateAgent for agent-tier orgs, Organization
  // for agency/expert. Both inherit name + description + url + sameAs.
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const profileUrl = `${site}/${locale}/${
    typedLocale === 'es' ? 'agentes' : 'agents'
  }/${slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': result.org.type === 'agent' ? 'RealEstateAgent' : 'Organization',
    name: result.org.name,
    url: profileUrl,
    ...(description ? { description } : {}),
    ...(result.org.website ? { sameAs: [result.org.website] } : {}),
    ...(result.org.logoUrl ? { image: result.org.logoUrl } : {}),
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
      <main>
        {/* Hero band — dot-grid + glow, logo or initials chip on the seam. */}
        <section className="relative overflow-hidden border-b border-border dark:bg-surface-deep">
          <DotGrid />
          <HeroGlow />
          <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-14 md:pb-20 md:pt-16">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
              {orgTypeLabel}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-5">
              {result.org.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.org.logoUrl}
                  alt={`${result.org.name} logo`}
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
            {result.org.website && (
              <p className="mt-5">
                <a
                  href={result.org.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-sm text-action underline-offset-2 hover:underline dark:text-action-dark"
                >
                  {t('websiteCta')} →
                </a>
              </p>
            )}
          </div>
        </section>

        <div className="mx-auto max-w-6xl space-y-10 px-6 py-12">
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
                  <ListingCard listing={l} locale={typedLocale} />
                </li>
              ))}
            </ul>
          )}
        </section>
        </div>
      </main>
    </>
  );
}
