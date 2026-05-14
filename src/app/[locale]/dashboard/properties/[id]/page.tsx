import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PublishButton } from '@/components/listings/publish-button';
import { ImageUploader } from '@/components/listings/image-uploader';
import { MarkAsSoldButton } from '@/components/listings/mark-as-sold-button';
import { ArchiveListingButton } from '@/components/listings/archive-listing-button';
import { EditListingForm } from '@/components/listings/edit-listing-form';
import { PhotoImportBanner } from '@/components/listings/photo-import-banner';
import { PhotoImportFailures } from '@/components/listings/photo-import-failures';
import {
  getCurrentUserOrgPlan,
  isOrgOnProAutomation,
} from '@/lib/billing/plan-gating';
import { LockedSocialModule } from '@/components/social/locked-social-module';
import { ShareToSocials, type ConnectedAccount, type SharePlatform } from '@/components/listings/share-to-socials';

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
      'id, short_id, status, title_en, title_es, slug_en, slug_es, description_en, description_es, city, state_region, country_code, price_cents, currency, price_period, image_count, published_at, updated_at, transaction_type, sold_date, sold_price_cents, bedrooms, bathrooms, area_sqm, lot_size_sqm, year_built, address_line, neighborhood, postal_code, display_address, amenities, features',
    )
    .eq('id', id)
    .maybeSingle();

  if (error || !listing) notFound();

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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[26px] md:leading-[1.19]">
            {title}
          </h1>
          <p className="mt-1 text-sm text-helper">
            <code className="font-mono">{listing.short_id}</code> ·{' '}
            {tStatus(listing.status)}
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        initialCount={listing.image_count}
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
