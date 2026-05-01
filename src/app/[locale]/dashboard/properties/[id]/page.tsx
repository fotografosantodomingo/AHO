import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { PublishButton } from '@/components/listings/publish-button';
import { ImageUploader } from '@/components/listings/image-uploader';
import { MarkAsSoldButton } from '@/components/listings/mark-as-sold-button';
import { ArchiveListingButton } from '@/components/listings/archive-listing-button';
import { EditListingForm } from '@/components/listings/edit-listing-form';

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

  const title =
    (typedLocale === 'es' ? listing.title_es : listing.title_en) ??
    listing.title_en ??
    listing.title_es ??
    '—';

  // Path to the public listing (only useful when status='active' AND a slug exists for this locale).
  const slugForLocale = typedLocale === 'es' ? listing.slug_es : listing.slug_en;
  const publicPath =
    listing.status === 'active' && slugForLocale
      ? `/${typedLocale}/${typedLocale === 'es' ? 'propiedades' : 'properties'}/${slugForLocale}-${listing.short_id}`
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
    </main>
  );
}
