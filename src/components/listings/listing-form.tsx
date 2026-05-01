'use client';

import { useMemo, useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  CreateListingSchema,
  type CreateListingInput,
  createListing,
} from '@/lib/listings/actions';
import { buildCountryOptions } from '@/lib/listings/countries-iso';
import { AMENITY_KEYS, type AmenityKey } from '@/lib/listings/amenities';

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';

const labelClass = 'block text-sm font-medium';

const PROPERTY_TYPES = [
  'apartment',
  'house',
  'condo',
  'villa',
  'land',
  'commercial',
] as const;

const CURRENCIES = ['USD', 'DOP', 'EUR'] as const;

interface ListingFormProps {
  /** When set, the form is in edit mode and pre-fills from this initial data. */
  initialValues?: Partial<CreateListingInput>;
  /** Where to redirect after a successful create. */
  successRedirectBase: string;
}

/**
 * Listing form. Five UX improvements over the previous version:
 *
 *   - Country: searchable dropdown of ISO 3166-1 alpha-2 codes with names
 *     localized via `Intl.DisplayNames` (no more typo-prone text input).
 *   - Period: only renders when transaction is rent / short_term — the
 *     "nightly" / "weekly" / "monthly" choices are meaningless for a sale
 *     listing and were confusing.
 *   - Amenities: 12-checkbox grid (parking, pool, garden, …) maps to the
 *     `properties.amenities text[]` column.
 *   - Price: collected in whole-currency units (e.g. `350000` for
 *     $350,000) instead of cents. Multiplied by 100 on submit. Saves
 *     every user from the cents-vs-dollars footgun.
 *   - Submit label: "Save as draft" — accurate to what the action does.
 *     Publish happens on the edit page once images are uploaded.
 */
export function ListingForm({ initialValues, successRedirectBase }: ListingFormProps) {
  const t = useTranslations('listingForm');
  const tDashboard = useTranslations('dashboard');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const countryOptions = useMemo(
    () => buildCountryOptions(locale === 'es' ? 'es' : 'en'),
    [locale],
  );

  // Form state for the conditional Period field. Local mirror of the
  // transaction_type to avoid threading react-hook-form's `watch` through
  // every render (cheaper + less noisy).
  const [transactionType, setTransactionType] = useState<
    'sale' | 'rent' | 'short_term'
  >((initialValues?.transaction_type as 'sale' | 'rent' | 'short_term') ?? 'sale');
  const isRental = transactionType === 'rent' || transactionType === 'short_term';

  // Amenities — controlled separately (checkbox group), then merged on submit.
  const [amenities, setAmenities] = useState<Set<AmenityKey>>(
    new Set((initialValues?.amenities as AmenityKey[] | undefined) ?? []),
  );
  function toggleAmenity(key: AmenityKey) {
    setAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Price — convert cents back to whole units for the form display.
  const initialPriceWhole = initialValues?.price_cents
    ? Math.round(Number(initialValues.price_cents) / 100)
    : undefined;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateListingInput>({
    resolver: zodResolver(CreateListingSchema),
    defaultValues: {
      transaction_type: 'sale',
      property_type: 'apartment',
      currency: 'USD',
      display_address: true,
      ...initialValues,
    },
  });

  function onSubmit(values: CreateListingInput) {
    setServerError(null);
    // Convert whole-units price back to cents for the DB column.
    const priceCents = Math.round(Number(values.price_cents) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) {
      setServerError('priceRequired');
      return;
    }
    const enriched: CreateListingInput = {
      ...values,
      price_cents: priceCents,
      // Period is meaningless for sale listings — drop it server-side too.
      price_period: isRental ? values.price_period ?? null : null,
      amenities: [...amenities],
    };

    startTransition(async () => {
      const result = await createListing(enriched);
      if (!result.ok) {
        setServerError(result.errorCode ?? 'create_failed');
        return;
      }
      router.push(`${successRedirectBase}/${result.id}`);
      router.refresh();
    });
  }

  const busy = isSubmitting || isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      <Section heading={t('sectionBasics')}>
        <Field>
          <label htmlFor="transaction_type" className={labelClass}>
            {t('transactionType')}
          </label>
          <select
            id="transaction_type"
            {...register('transaction_type', {
              onChange: (e) =>
                setTransactionType(e.target.value as 'sale' | 'rent' | 'short_term'),
            })}
            className={inputClass}
          >
            <option value="sale">{locale === 'es' ? 'Venta' : 'Sale'}</option>
            <option value="rent">{locale === 'es' ? 'Alquiler' : 'Rent'}</option>
            <option value="short_term">
              {locale === 'es' ? 'Alquiler temporal' : 'Short-term rental'}
            </option>
          </select>
        </Field>

        <Field>
          <label htmlFor="property_type" className={labelClass}>
            {t('propertyType')}
          </label>
          <select id="property_type" {...register('property_type')} className={inputClass}>
            {PROPERTY_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <label htmlFor="title_en" className={labelClass}>
            {t('titleEn')}
          </label>
          <input id="title_en" type="text" {...register('title_en')} className={inputClass} />
        </Field>

        <Field>
          <label htmlFor="title_es" className={labelClass}>
            {t('titleEs')}
          </label>
          <input id="title_es" type="text" {...register('title_es')} className={inputClass} />
          <p className="mt-1 text-xs text-helper">{t('atLeastOneLanguage')}</p>
          {errors.title_en && (
            <p className="mt-1 text-sm text-red-600">{t('errors.titleRequired')}</p>
          )}
        </Field>

        <Field className={`grid gap-3 ${isRental ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <div>
            <label htmlFor="price_cents" className={labelClass}>
              {t('price')}
            </label>
            <input
              id="price_cents"
              type="number"
              step="1"
              min="1"
              defaultValue={initialPriceWhole}
              {...register('price_cents', { valueAsNumber: true })}
              className={inputClass}
            />
            {errors.price_cents && (
              <p className="mt-1 text-sm text-red-600">{t('errors.priceRequired')}</p>
            )}
          </div>
          <div>
            <label htmlFor="currency" className={labelClass}>
              {t('currency')}
            </label>
            <select id="currency" {...register('currency')} className={inputClass}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {/* Period only makes sense for rentals. Hidden entirely for sale
              listings so users don't see / fill irrelevant fields. */}
          {isRental && (
            <div>
              <label htmlFor="price_period" className={labelClass}>
                {t('pricePeriod')}
              </label>
              <select
                id="price_period"
                {...register('price_period')}
                className={inputClass}
              >
                <option value="monthly">monthly</option>
                <option value="weekly">weekly</option>
                <option value="nightly">nightly</option>
              </select>
            </div>
          )}
        </Field>
      </Section>

      <Section heading={t('sectionDetails')}>
        <Field className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="bedrooms" className={labelClass}>
              {t('bedrooms')}
            </label>
            <input
              id="bedrooms"
              type="number"
              min="0"
              step="1"
              {...register('bedrooms', {
                valueAsNumber: true,
                setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)),
              })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="bathrooms" className={labelClass}>
              {t('bathrooms')}
            </label>
            <input
              id="bathrooms"
              type="number"
              min="0"
              step="0.5"
              {...register('bathrooms', {
                valueAsNumber: true,
                setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)),
              })}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="area_sqm" className={labelClass}>
              {t('areaSqm')}
            </label>
            <input
              id="area_sqm"
              type="number"
              min="1"
              step="0.01"
              {...register('area_sqm', {
                valueAsNumber: true,
                setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)),
              })}
              className={inputClass}
            />
          </div>
        </Field>

        {/* Amenities — 4-col grid on md+, 2-col on mobile. Toggling a
            checkbox flips a Set entry; the Set is merged into the
            submission payload via `amenities`. */}
        <Field>
          <p className={labelClass}>{t('amenitiesHeading')}</p>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
            {AMENITY_KEYS.map((key) => {
              const checked = amenities.has(key);
              return (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
                    checked
                      ? 'border-action bg-action/10 text-action dark:border-action-dark dark:bg-action-dark/15 dark:text-action-dark'
                      : 'border-border bg-surface hover:bg-black/5 dark:bg-surface-deep dark:hover:bg-white/5'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleAmenity(key)}
                    className="sr-only"
                  />
                  <span aria-hidden="true">{checked ? '✓' : '+'}</span>
                  <span>{t(`amenities.${key}` as 'amenities.parking')}</span>
                </label>
              );
            })}
          </div>
        </Field>
      </Section>

      <Section heading={t('sectionLocation')}>
        <Field>
          <label htmlFor="address_line" className={labelClass}>
            {t('addressLine')}
          </label>
          <input
            id="address_line"
            type="text"
            {...register('address_line')}
            className={inputClass}
          />
        </Field>
        <Field className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="neighborhood" className={labelClass}>
              {t('neighborhood')}
            </label>
            <input
              id="neighborhood"
              type="text"
              {...register('neighborhood')}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="city" className={labelClass}>
              {t('city')} *
            </label>
            <input id="city" type="text" required {...register('city')} className={inputClass} />
            {errors.city && (
              <p className="mt-1 text-sm text-red-600">{t('errors.cityRequired')}</p>
            )}
          </div>
        </Field>
        <Field className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="state_region" className={labelClass}>
              {t('stateRegion')}
            </label>
            <input
              id="state_region"
              type="text"
              {...register('state_region')}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="country_code" className={labelClass}>
              {t('countryCode')} *
            </label>
            <select
              id="country_code"
              required
              {...register('country_code')}
              className={inputClass}
              defaultValue={initialValues?.country_code ?? ''}
            >
              <option value="" disabled>
                {locale === 'es' ? 'Selecciona un país' : 'Select a country'}
              </option>
              {countryOptions.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            {errors.country_code && (
              <p className="mt-1 text-sm text-red-600">{t('errors.countryRequired')}</p>
            )}
          </div>
          <div>
            <label htmlFor="postal_code" className={labelClass}>
              {t('postalCode')}
            </label>
            <input
              id="postal_code"
              type="text"
              {...register('postal_code')}
              className={inputClass}
            />
          </div>
        </Field>
        <Field className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="latitude" className={labelClass}>
              {t('latitude')} *
            </label>
            <input
              id="latitude"
              type="number"
              step="any"
              required
              {...register('latitude', { valueAsNumber: true })}
              className={inputClass}
            />
            {errors.latitude && (
              <p className="mt-1 text-sm text-red-600">{t('errors.latRequired')}</p>
            )}
          </div>
          <div>
            <label htmlFor="longitude" className={labelClass}>
              {t('longitude')} *
            </label>
            <input
              id="longitude"
              type="number"
              step="any"
              required
              {...register('longitude', { valueAsNumber: true })}
              className={inputClass}
            />
            {errors.longitude && (
              <p className="mt-1 text-sm text-red-600">{t('errors.lngRequired')}</p>
            )}
          </div>
        </Field>
        <Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('display_address')} className="h-4 w-4" />
            {t('displayAddress')}
          </label>
        </Field>
      </Section>

      <Section heading={t('sectionDescription')}>
        <Field>
          <label htmlFor="description_en" className={labelClass}>
            {t('descriptionEn')}
          </label>
          <textarea
            id="description_en"
            rows={5}
            {...register('description_en')}
            className={inputClass}
          />
        </Field>
        <Field>
          <label htmlFor="description_es" className={labelClass}>
            {t('descriptionEs')}
          </label>
          <textarea
            id="description_es"
            rows={5}
            {...register('description_es')}
            className={inputClass}
          />
        </Field>
      </Section>

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {serverError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center rounded-lg bg-surface-dark px-5 text-sm font-medium text-ink-inverse-muted shadow-whisper transition hover:bg-ink disabled:opacity-50"
        >
          {busy ? '…' : tDashboard('saveAsDraft')}
        </button>
        <p className="text-xs text-helper">{t('publishAfterImages')}</p>
      </div>
    </form>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {heading}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}
