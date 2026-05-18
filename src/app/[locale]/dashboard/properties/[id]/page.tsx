import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PublishButton } from '@/components/listings/publish-button';
import { ImageUploader } from '@/components/listings/image-uploader';
import { ExistingImagesEditor } from '@/components/listings/existing-images-editor';
import { MarkAsSoldButton } from '@/components/listings/mark-as-sold-button';
import { ArchiveListingButton } from '@/components/listings/archive-listing-button';
import { EditListingForm } from '@/components/listings/edit-listing-form';
import { PhotoImportBanner } from '@/components/listings/photo-import-banner';
import { PhotoImportFailures } from '@/components/listings/photo-import-failures';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import nextDynamic from 'next/dynamic';
import { LockedSocialModule } from '@/components/social/locked-social-module';
import type { ConnectedAccount, SharePlatform } from '@/components/listings/share-to-socials';
import { getCountryName } from '@/lib/i18n/countries';
import type { TransactionType } from '@/lib/listings/photo-seo';

// Lazy-load ShareToSocials — only Pro Automation tier sees it, and it
// drags ~62 KiB of state-machine logic + per-platform UI branches.
// Deferring lets the rest of the edit page hydrate fast for the
// non-Pro tier path (which never renders this anyway).
const ShareToSocials = nextDynamic(
  () => import('@/components/listings/share-to-socials').then((m) => ({ default: m.ShareToSocials })),
  { loading: () => null },
);

export const runtime = 'edge';

export const dynamic = 'force-dynamic';

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!LOCALES.includes(locale as Locale)) return null;
  const typedLocale = locale as Locale;
  setRequestLocale(typedLocale);

  const supabase = await createServerSupabaseClient();
  const { data: listing, error } = await supabase
    .from('properties')
    .select(
      'id, short_id, status, title_en, title_es, slug_en, slug_es, description_en, description_es, city, state_region, country_code, price_cents, currency, price_period, image_count, published_at, updated_at, transaction_type, property_type, sold_date, sold_price_cents, bedrooms, bathrooms, area_sqm, lot_size_sqm, year_built, address_line, neighborhood, postal_code, display_address, amenities, features',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !listing) notFound();

  // Fetch confirmed images for the alt-text editor. Small (≤30 rows),
  // gated by the property_images org-member RLS policy. Reading any
  // unconfirmed (status='pending') rows would surface uploads that
  // failed bytes-PUT; skip them.
  const { data: existingImages } = await supabase
    .from('property_images')
    .select('id, cf_image_id, r2_key, alt_text_en, alt_text_es, position, is_primary, upload_status')
    .eq('property_id', listing.id)
    .eq('upload_status', 'confirmed')
    .order('position', { ascending: true });

  const tStatus = await getTranslations({ locale, namespace: 'dashboard.status' });

  // Plan-gating context for the social-automation module rendered
  // below the listing form. Lower-tier orgs see the locked upsell;
  // Pro Automation orgs see the unlocked placeholder (Phase 4 OAuth
  // UI replaces this).
  const planCtx = await getCurrentUserOrgPlan(supabase);
  const proUnlocked = planCtx
    ? await isOrgOnProAutomation(supabase, planCtx.orgId)
    : false;

  // Pro Automation users — fetch their connected social accounts now so
  // the <ShareToSocials> component renders the right state (empty vs
  // pre-flight list) on first paint. RLS allows the owner to read their
  // own `ad_platform_tokens` rows.
  const connectedAccounts: ConnectedAccount[] = [];
  if (proUnlocked) {
    const { data: tokens } = await supabase
      .from('ad_platform_tokens')
      .select('platform, external_account_id, display_name')
      .is('revoked_at', null);
    for (const t of tokens ?? []) {
      if (t.platform === 'meta') {
        if (t.external_account_id.startsWith('page:')) {
          connectedAccounts.push({
            platform: 'facebook',
            externalAccountId: t.external_account_id,
            displayName: t.display_name,
          });
        } else if (t.external_account_id.startsWith('ig:')) {
          connectedAccounts.push({
            platform: 'instagram',
            externalAccountId: t.external_account_id,
            displayName: t.display_name,
          });
        }
        // Skip the user-level meta token row — it's not a publish target.
      } else if (t.platform === 'linkedin') {
        connectedAccounts.push({
          platform: 'linkedin' as SharePlatform,
          externalAccountId: t.external_account_id,
          displayName: t.display_name,
        });
      }
    }
  }

  const title =
    (typedLocale === 'es' ? listing.title_es : listing.title_en) ??
    listing.title_en ??
    listing.title_es ??
    '—';

  // Path to the public listing (only useful when status='active' AND a slug exists for this locale).
  const slugForLocale = typedLocale === 'es' ? listing.slug_es : listing.slug_en;
  const propertyStem = localePath(typedLocale, '/properties/[slug]').replace(
    '/[slug]',
    '',
  );
  const publicPath =
    listing.status === 'active' && slugForLocale
      ? `${propertyStem}/${slugForLocale}-${listing.short_id}`
      : null;

  return (
    <main className="space-y-6">
      <header className="space-y-4">
        <div className="min-w-0">
          <h1 className="break-words font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
            {title}
          </h1>
          <p className="mt-1 text-sm text-helper">
            <code className="font-mono">{listing.short_id}</code> ·{' '}
            {tStatus(listing.status)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {publicPath && (
            <a
              href={publicPath}
              className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
              target="_blank"
              rel="noreferrer"
            >
              View public page
            </a>
          )}
          {listing.status === 'draft' && <PublishButton id={listing.id} />}
          {listing.status === 'active' && (
            <MarkAsSoldButton
              id={listing.id}
              currency={listing.currency}
              intent={listing.transaction_type === 'rent' || listing.transaction_type === 'short_term' ? 'rented' : 'sold'}
            />
          )}
          {listing.status !== 'sold' && listing.status !== 'rented' && (
            <ArchiveListingButton
              id={listing.id}
              isArchived={listing.status === 'archived'}
            />
          )}
        </div>
      </header>

      {/* Post-redirect banner reporting URL-import photo migration
          results (imported / failed counts + per-URL error codes).
          Reads from sessionStorage and self-clears; renders nothing
          when the user didn't arrive here from the import flow. */}
      <PhotoImportBanner propertyId={listing.id} />

      {/* Persistent dead-letter list (migration 0037). Reads unresolved
          rows from photo_import_failures every page load so an agent
          returning later still sees URLs that failed and can retry or
          dismiss them. Renders nothing when there are no unresolved
          failures, so this is invisible for new listings. */}
      <PhotoImportFailures propertyId={listing.id} />

      <EditListingForm
        initial={{
          id: listing.id,
          status: listing.status,
          titleEn: listing.title_en,
          titleEs: listing.title_es,
          descriptionEn: listing.description_en,
          descriptionEs: listing.description_es,
          priceCents: Number(listing.price_cents),
          currency: listing.currency,
          pricePeriod: listing.price_period,
          bedrooms: listing.bedrooms,
          bathrooms: listing.bathrooms != null ? Number(listing.bathrooms) : null,
          areaSqm: listing.area_sqm != null ? Number(listing.area_sqm) : null,
          lotSizeSqm: listing.lot_size_sqm != null ? Number(listing.lot_size_sqm) : null,
          yearBuilt: listing.year_built,
          addressLine: listing.address_line,
          neighborhood: listing.neighborhood,
          postalCode: listing.postal_code,
          displayAddress: listing.display_address,
          amenities: (listing.amenities as string[] | null) ?? [],
          features: listing.features ?? {},
        }}
      />

      <ImageUploader
        propertyId={listing.id}
        titleEn={listing.title_en}
        titleEs={listing.title_es}
        city={listing.city}
        propertyType={listing.property_type}
        transactionType={listing.transaction_type as TransactionType}
        countryDisplayEn={getCountryName(listing.country_code, 'en')}
        countryDisplayEs={getCountryName(listing.country_code, 'es')}
        initialCount={listing.image_count}
      />

      {/* Per-photo alt-text editor — server-rendered with the confirmed
          images so the agent can write descriptive captions per photo.
          Strong image SEO depends on agents writing meaningful alt text
          (e.g. "Master bedroom with ocean view at sunset") — generic
          auto-generated alt ("Villa — Sosúa — 5") doesn't compete in
          Google Image Search. */}
      <ExistingImagesEditor
        propertyId={listing.id}
        images={(existingImages ?? []).map((row) => ({
          id: row.id as string,
          cfImageId: (row.cf_image_id as string | null) ?? null,
          r2Key: row.r2_key as string,
          altTextEn: (row.alt_text_en as string | null) ?? null,
          altTextEs: (row.alt_text_es as string | null) ?? null,
          position: row.position as number,
          isPrimary: row.is_primary as boolean,
        }))}
      />


      {/* Social Media Automation — visible to all paid agents, interactive
          only on Pro Automation. Lower tiers see the locked upsell + the
          "Upgrade to Pro Automation" CTA. Pro Automation orgs see the
          real one-click share surface (Phase F of
          docs/SOCIAL_AUTOMATION_PLAN.md). */}
      {proUnlocked ? (
        <ShareToSocials
          propertyId={listing.id}
          locale={typedLocale}
          connectedAccounts={connectedAccounts}
          isPublished={listing.status === 'active' && !!listing.published_at}
        />
      ) : (
        <LockedSocialModule locale={typedLocale} size="compact" />
      )}
    </main>
  );
}
