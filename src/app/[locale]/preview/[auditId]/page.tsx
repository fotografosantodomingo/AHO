import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ImportedFacts } from '@/lib/listings/import-from-url';
import type { DrafterResult } from '@/lib/social/ai-drafter';
import { formatPrice } from '@/lib/listings/format';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

interface PageParams {
  locale: string;
  auditId: string;
}

export const metadata: Metadata = {
  // The audit preview is a private, single-shot lead-magnet — keep it
  // out of search results so we don't index per-visitor scrape pages
  // that age out after 7 days.
  robots: { index: false, follow: false },
};

/**
 * Free Audit preview screen — Phase 1 of
 * docs/SUPER_PRO_STAGE_1_PLAN.md.
 *
 * Lands here from /api/audit/start. Reads the audit row via the
 * admin client (RLS allows public SELECT anyway; admin is just for
 * the same idempotent path on every render).
 *
 * Shows:
 *   - Listing facts (title, price, beds/baths, area, city)
 *   - Up to 3 hero photos
 *   - 3 platforms × 3 locales = 9 captions
 *   - Single CTA: "Sign up to publish these on Facebook + Instagram in 1 click"
 *
 * Phase 2 will add the Creative Factory grid (FB 1200×630 / IG 1080² /
 * Pinterest 1000×1500 graphics). Phase 3 wires the "Publish approved"
 * button. For now the value is the AI-generated copy: cold visitor
 * proves AHO works in 60 seconds, then signs up.
 */
export default async function PreviewPage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, auditId } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const admin = createAdminClient();
  const { data: audit } = await admin
    .from('ai_audits')
    .select('id, source_url, facts, drafts, created_at, expires_at, claimed_by_user_id')
    .eq('id', auditId)
    .maybeSingle();

  if (!audit) notFound();

  const facts = audit.facts as ImportedFacts;
  const drafts = audit.drafts as Record<'en' | 'es' | 'pl', DrafterResult>;

  const t = await getTranslations({ locale, namespace: 'freeAudit' });
  const signupHref = localePath(typedLocale, '/signup');

  // Title — prefer the user's locale, fall back across the available
  // facts.titleEn / titleEs (importer always writes both).
  const title =
    (typedLocale === 'es' ? facts.titleEs : facts.titleEn) ??
    facts.titleEn ??
    facts.titleEs ??
    t('previewListing');

  const priceLabel =
    facts.priceCents && facts.priceCents > 0 && facts.currency
      ? formatPrice(facts.priceCents, facts.currency, typedLocale)
      : null;

  // Hero photos — show up to 3. Importer caps at 30 and filters out
  // sprite / icon URLs upstream, so what we have is presentable.
  const photos = (facts.photoUrls ?? []).slice(0, 3);

  const platforms: Array<{
    key: 'facebook' | 'instagram' | 'linkedin';
    label: string;
    emoji: string;
  }> = [
    { key: 'facebook', label: 'Facebook', emoji: '📘' },
    { key: 'instagram', label: 'Instagram', emoji: '📷' },
    { key: 'linkedin', label: 'LinkedIn', emoji: '💼' },
  ];

  const draftLocales: Array<{ key: 'en' | 'es' | 'pl'; label: string }> = [
    { key: 'en', label: t('localeEn') },
    { key: 'es', label: t('localeEs') },
    { key: 'pl', label: t('localePl') },
  ];

  return (
    // Force-light theme on the preview page — this is a marketing /
    // conversion screen where the bright cream surface reads as
    // welcoming + premium. Stripping every `dark:` modifier inside
    // and wrapping in an explicit `bg-surface text-ink` block means
    // a visitor with system dark mode still lands on the bright
    // template the design was tuned for. Outer wrapper sets the
    // background so the dark body bg never bleeds through.
    <div className="bg-surface text-ink" style={{ colorScheme: 'light' }}>
    <main className="mx-auto max-w-6xl px-4 py-10 md:px-6 md:py-16">
      <header className="space-y-3">
        <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-action">
          {t('eyebrow')}
        </p>
        <h1 className="font-brand text-3xl font-semibold tracking-tight md:text-[40px] md:leading-[1.1]">
          {t('heading')}
        </h1>
        <p className="max-w-2xl text-base text-ink-muted md:text-lg">
          {t('subheading')}
        </p>
      </header>

      {/* Listing facts card */}
      <section
        aria-labelledby="audit-listing-heading"
        className="mt-8 rounded-card border border-border bg-surface p-6 shadow-whisper"
      >
        <h2
          id="audit-listing-heading"
          className="font-brand text-xl font-semibold tracking-tight md:text-2xl"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm text-helper">
          <a
            href={audit.source_url as string}
            target="_blank"
            rel="noreferrer noopener"
            className="underline-offset-2 hover:underline"
          >
            {t('sourceLink')} ↗
          </a>
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {priceLabel && (
            <FactCell label={t('factPrice')} value={priceLabel} />
          )}
          {facts.city && (
            <FactCell label={t('factCity')} value={facts.city} />
          )}
          {facts.bedrooms != null && (
            <FactCell
              label={t('factBedrooms')}
              value={String(facts.bedrooms)}
            />
          )}
          {facts.bathrooms != null && (
            <FactCell
              label={t('factBathrooms')}
              value={String(facts.bathrooms)}
            />
          )}
          {facts.areaSqm != null && (
            <FactCell
              label={t('factArea')}
              value={`${facts.areaSqm} m²`}
            />
          )}
        </dl>

        {photos.length > 0 && (
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {photos.map((url, idx) => (
              <li
                key={url}
                className="aspect-[4/3] overflow-hidden rounded-card bg-surface-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`${title} — photo ${idx + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Creative Factory v1 (Phase 2 of SUPER_PRO_STAGE_1_PLAN.md):
          three branded graphic formats rendered on-demand by
          /api/audit/[id]/creative/[format]. Each <img> hits that
          edge route which composes the listing photo + title + price
          + "Powered by AHO" footer via next/og. The browser pays
          ~one network hit per format; the route caches 1h at the
          edge so a second visitor on the same audit is instant. */}
      <section
        aria-labelledby="audit-creatives-heading"
        className="mt-10 space-y-4"
      >
        <h2
          id="audit-creatives-heading"
          className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]"
        >
          {t('creativesHeading')}
        </h2>
        <p className="text-sm text-helper">{t('creativesSub')}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(['fb', 'ig', 'pin'] as const).map((fmt) => (
            <figure
              key={fmt}
              className="overflow-hidden rounded-card border border-border bg-surface shadow-whisper"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/audit/${auditId}/creative/${fmt}`}
                alt={t(`creativeAlt.${fmt}` as 'creativeAlt.fb')}
                loading="lazy"
                className="block w-full bg-surface-muted"
              />
              <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-helper">
                <span>{t(`creativeLabel.${fmt}` as 'creativeLabel.fb')}</span>
                <a
                  href={`/api/audit/${auditId}/creative/${fmt}`}
                  download={`aho-${fmt}.png`}
                  className="font-medium text-action underline-offset-2 hover:underline"
                >
                  {t('downloadCreative')} ↓
                </a>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Captions grid — locales as rows, platforms as columns */}
      <section
        aria-labelledby="audit-captions-heading"
        className="mt-10 space-y-6"
      >
        <h2
          id="audit-captions-heading"
          className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]"
        >
          {t('captionsHeading')}
        </h2>

        {draftLocales.map((loc) => {
          const localeResult = drafts[loc.key];
          return (
            <div key={loc.key} className="space-y-3">
              <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
                {loc.label}
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {platforms.map((plat) => {
                  const text = extractDraftText(localeResult, plat.key);
                  return (
                    <article
                      key={`${loc.key}-${plat.key}`}
                      className="flex flex-col rounded-card border border-border bg-surface p-4 shadow-whisper"
                    >
                      <header className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                        <span aria-hidden="true">{plat.emoji}</span>
                        <span>{plat.label}</span>
                      </header>
                      {text ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                          {text}
                        </p>
                      ) : (
                        <p className="text-sm italic text-helper">
                          {t('draftUnavailable')}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* Conversion CTA */}
      <aside className="mt-12 rounded-card border border-action/30 bg-action/5 p-6 text-center md:p-10">
        <h2 className="font-brand text-2xl font-semibold tracking-tight md:text-[32px]">
          {t('ctaHeading')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-base text-ink-muted">
          {t('ctaSub')}
        </p>
        <div className="mt-6">
          <a
            href={`${signupHref}?from=audit&audit=${auditId}`}
            className="btn-primary inline-flex h-12 items-center px-8 text-base font-semibold"
          >
            {t('ctaButton')} →
          </a>
        </div>
      </aside>
    </main>
    </div>
  );
}

/** Per-platform draft shape varies (FB.message / IG.caption / LinkedIn
 *  has commentary + title + description). Extract the right field per
 *  platform so the preview card can render plain text without leaking
 *  the structured object into JSX. */
function extractDraftText(
  result: DrafterResult | undefined,
  platform: 'facebook' | 'instagram' | 'linkedin',
): string | null {
  if (!result?.drafts) return null;
  if (platform === 'facebook') return result.drafts.facebook?.message ?? null;
  if (platform === 'instagram') return result.drafts.instagram?.caption ?? null;
  const li = result.drafts.linkedin;
  return li?.commentary ?? null;
}

function FactCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-helper">{label}</dt>
      <dd className="mt-1 font-brand text-lg font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
