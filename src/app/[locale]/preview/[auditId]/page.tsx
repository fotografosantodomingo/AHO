import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ImportedFacts } from '@/lib/listings/import-from-url';
import type { DrafterResult } from '@/lib/social/ai-drafter';
import { formatPrice } from '@/lib/listings/format';
import { ApprovalGrid } from '@/components/preview/approval-grid';

interface PublishedResult {
  locale: 'en' | 'es' | 'pl';
  platform: 'facebook' | 'instagram' | 'linkedin';
  ok: boolean;
  external_post_id?: string;
  external_post_url?: string;
  error_code?: string;
  error_message?: string;
  attempted_at: string;
}

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
    .select('id, source_url, facts, drafts, target_locale, created_at, expires_at, claimed_by_user_id, published_results')
    .eq('id', auditId)
    .maybeSingle();

  if (!audit) notFound();

  // Auth context. Two outcomes matter:
  //   - signed-in user with `claimed_by_user_id === self`: render the
  //     ApprovalGrid (Phase 3 publish UI)
  //   - signed-in user with audit unclaimed: claim it now (the audit
  //     belongs to whichever signed-in user converts first), then render
  //     the grid as the owner
  //   - signed-in user with audit claimed by SOMEONE ELSE: still render
  //     captions + creatives (the URL is public), but no publish UI —
  //     this happens if an audit URL is shared to another agent
  //   - anonymous user: render the signup CTA (status quo)
  const userSupabase = await createServerSupabaseClient();
  const { data: userResult } = await userSupabase.auth.getUser();
  const viewerId = userResult.user?.id ?? null;
  let claimedBy = (audit.claimed_by_user_id as string | null) ?? null;
  // Funnel-event side-effects — Phase 5.6 / pitch metric. Single
  // `headers()` call powers both the claim row's missing IP-hash
  // gap AND the funnel event rows. SHA-256 keeps us out of PII
  // territory while letting us de-dup same-network reloads.
  const reqHeaders = await headers();
  const rawIp =
    reqHeaders.get('cf-connecting-ip') ??
    reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  const ipHash = rawIp ? await sha256Hex(rawIp) : null;
  const userAgent = reqHeaders.get('user-agent')?.slice(0, 500) ?? null;

  const justClaimed = viewerId && !claimedBy;
  if (justClaimed && viewerId) {
    await admin
      .from('ai_audits')
      .update({ claimed_by_user_id: viewerId, claimed_at: new Date().toISOString() })
      .eq('id', auditId);
    claimedBy = viewerId;
  }
  const isOwner = !!viewerId && claimedBy === viewerId;

  // Funnel writes. We AWAIT these even though they're per-request
  // side-effects — Cloudflare Edge runtime kills unawaited promises
  // when the response is sent (QA finding 2026-05-17 reproduced this
  // as 0 rows in audit_funnel_events despite real audit traffic).
  // The cost is one extra DB round-trip per page render (~30-50ms);
  // the alternative (using ctx.waitUntil) requires reaching into
  // next-on-pages internals which is fragile. Try/catch keeps a
  // logging-write failure from breaking the page render.
  // Destructure the PostgrestResponse — supabase-js does NOT throw on
  // row-level errors (RLS denial, constraint failure, schema mismatch).
  // Pre-2026-05-18 we only logged catches around network throws and
  // silent insert failures produced 0 rows in production without ever
  // surfacing in logs. Now we log the postgrest error if present.
  try {
    const view = await admin.from('audit_funnel_events').insert({
      audit_id: auditId,
      event: 'preview_view',
      ip_hash: ipHash,
      user_id: viewerId,
      locale,
      user_agent: userAgent,
    });
    if (view.error) {
      console.error('[preview] funnel postgrest error (view)', {
        code: view.error.code,
        message: view.error.message,
        details: view.error.details,
        hint: view.error.hint,
        auditId,
      });
    }
    if (justClaimed) {
      const claim = await admin.from('audit_funnel_events').insert({
        audit_id: auditId,
        event: 'preview_claim',
        ip_hash: ipHash,
        user_id: viewerId,
        locale,
        user_agent: userAgent,
      });
      if (claim.error) {
        console.error('[preview] funnel postgrest error (claim)', {
          code: claim.error.code,
          message: claim.error.message,
          auditId,
        });
      }
    }
  } catch (err) {
    console.error('[preview] funnel insert threw', err);
  }

  const facts = audit.facts as ImportedFacts;
  // `drafts` is keyed by locale. Since 2026-05-28 there's exactly one
  // entry (the agent-chosen target locale, persisted on
  // ai_audits.target_locale). Pre-migration rows have 3 entries
  // (en/es/pl); we iterate Object.keys() so both shapes render.
  const drafts = (audit.drafts ?? {}) as Partial<Record<Locale, DrafterResult>>;
  const publishedResults = (audit.published_results as PublishedResult[] | null) ?? [];
  // Resolve the locale this audit was generated for. New rows have
  // target_locale set; old rows fall back to whatever drafts keys
  // exist (preferring the URL locale, then EN as last resort).
  const draftKeys = Object.keys(drafts) as Locale[];
  const auditTargetLocale: Locale =
    (audit.target_locale as Locale | null) ??
    (draftKeys.includes(typedLocale) ? typedLocale : draftKeys[0] ?? 'en');

  // Connection state for the approval grid (Phase 4 slice 4d /
  // "easier OAuth UX"). When owner = self, pull their ad_platform_tokens
  // and derive per-platform connection booleans + display names. The
  // grid uses this to show ✓ Connected as "X" vs a "Connect →" button
  // inline — so the agent fixes the missing connection where they hit
  // the problem, not by navigating elsewhere.
  // Phase 3.5: connections now carry ALL accounts per platform, not
  // just the first one. Agency users frequently have 2-6 FB Pages
  // (one per agency brand) and the prior "first wins" pick was a
  // silent constraint. Approval grid renders a picker when accounts.length > 1.
  type PlatformAccount = {
    externalAccountId: string;
    displayName: string | null;
  };
  type PlatformConnection = {
    platform: 'facebook' | 'instagram' | 'linkedin';
    accounts: PlatformAccount[];
  };
  const connections: PlatformConnection[] = [
    { platform: 'facebook', accounts: [] },
    { platform: 'instagram', accounts: [] },
    { platform: 'linkedin', accounts: [] },
  ];
  if (isOwner && viewerId) {
    const { data: tokens } = await admin
      .from('ad_platform_tokens')
      .select('platform, external_account_id, display_name')
      .eq('user_id', viewerId)
      .is('revoked_at', null);
    for (const t of tokens ?? []) {
      const accountEntry: PlatformAccount = {
        externalAccountId: t.external_account_id as string,
        displayName: (t.display_name as string | null) ?? null,
      };
      if (t.platform === 'meta' && t.external_account_id?.startsWith('page:')) {
        connections.find((c) => c.platform === 'facebook')!.accounts.push(accountEntry);
      } else if (t.platform === 'meta' && t.external_account_id?.startsWith('ig:')) {
        connections.find((c) => c.platform === 'instagram')!.accounts.push(accountEntry);
      } else if (t.platform === 'linkedin') {
        connections.find((c) => c.platform === 'linkedin')!.accounts.push(accountEntry);
      }
      // Skip the user-level Meta token — not a publish target.
    }
  }

  const t = await getTranslations({ locale, namespace: 'freeAudit' });
  const signupHref = localePath(typedLocale, '/signup');

  // Title — prefer the audit's target locale (the agent's choice when
  // they submitted the URL). For ES we have a translated column from
  // the importer; for EN we have the canonical column; PL/PT/DE/FR/IT
  // fall back to EN until the importer learns to translate the title
  // for the agent's target market (Phase 2 polish — single Haiku call
  // adds ~$0.0002/audit, deferred as not blocking the UX win).
  const title =
    (auditTargetLocale === 'es' ? facts.titleEs : facts.titleEn) ??
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

  // Captions block iterates whatever locale keys the audit actually
  // has — exactly one for new audits (target_locale chosen by the
  // agent), up to 3 for pre-migration ones (en/es/pl fanout).
  const draftLocaleLabels: Record<Locale, string> = {
    en: t('localeEn'),
    es: t('localeEs'),
    pl: t('localePl'),
    pt: t('localePt' as 'localeEn'),
    de: t('localeDe' as 'localeEn'),
    fr: t('localeFr' as 'localeEn'),
    it: t('localeIt' as 'localeEn'),
  };
  const draftLocales: Array<{ key: Locale; label: string }> = draftKeys.map(
    (k) => ({ key: k, label: draftLocaleLabels[k] }),
  );

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
                src={`/api/audit/${auditId}/creative/${fmt}?locale=${auditTargetLocale}`}
                alt={t(`creativeAlt.${fmt}` as 'creativeAlt.fb')}
                loading="lazy"
                className="block w-full bg-surface-muted"
              />
              <figcaption className="flex items-center justify-between px-3 py-2 text-xs text-helper">
                <span>{t(`creativeLabel.${fmt}` as 'creativeLabel.fb')}</span>
                <a
                  href={`/api/audit/${auditId}/creative/${fmt}?locale=${auditTargetLocale}`}
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

      {/* Owner → publish flow (Phase 3): inline approval grid with
          per-cell checkboxes + one "Publish approved" button that
          fans out to the existing FB / IG / LinkedIn publish
          primitives via /api/audit/[id]/publish. Anon / non-owner →
          conversion CTA toward signup, same as before. */}
      {isOwner ? (
        <ApprovalGrid
          auditId={auditId}
          locale={typedLocale}
          drafts={drafts}
          publishedResults={publishedResults}
          connections={connections}
        />
      ) : (
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
      )}
    </main>
    </div>
  );
}

/** Hash a client IP for funnel-event de-duplication without storing
 *  raw IPs (same pattern as /api/audit/start). Edge-compatible. */
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
