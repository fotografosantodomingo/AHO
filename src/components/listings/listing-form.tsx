'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  CreateListingSchema,
  type CreateListingInput,
  createListing,
} from '@/lib/listings/actions';

const inputClass =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:ring-zinc-100';

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

export function ListingForm({ initialValues, successRedirectBase }: ListingFormProps) {
  const t = useTranslations('listingForm');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

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
      country_code: 'DO',
      city: 'Santo Domingo',
      display_address: true,
      ...initialValues,
    },
  });

  function onSubmit(values: CreateListingInput) {
    setServerError(null);
    startTransition(async () => {
      const result = await createListing(values);
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
            {...register('transaction_type')}
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
          <p className="mt-1 text-xs text-zinc-500">{t('atLeastOneLanguage')}</p>
          {errors.title_en && (
            <p className="mt-1 text-sm text-red-600">{t('errors.titleRequired')}</p>
          )}
        </Field>

        <Field className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="price_cents" className={labelClass}>
              {t('price')} (cents)
            </label>
            <input
              id="price_cents"
              type="number"
              step="1"
              min="1"
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
          <div>
            <label htmlFor="price_period" className={labelClass}>
              {t('pricePeriod')}
            </label>
            <select id="price_period" {...register('price_period')} className={inputClass}>
              <option value="">—</option>
              <option value="total">total</option>
              <option value="monthly">monthly</option>
              <option value="weekly">weekly</option>
              <option value="nightly">nightly</option>
            </select>
          </div>
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
              {...register('bedrooms', { valueAsNumber: true, setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)) })}
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
              {...register('bathrooms', { valueAsNumber: true, setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)) })}
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
              {...register('area_sqm', { valueAsNumber: true, setValueAs: (v) => (v === '' || isNaN(v) ? null : Number(v)) })}
              className={inputClass}
            />
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
            <input
              id="country_code"
              type="text"
              required
              maxLength={2}
              {...register('country_code')}
              className={inputClass}
            />
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

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-10 items-center rounded-md bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? '…' : t('saved') /* "Saved." doubles as the in-progress label until we add a real "Saving..." key */}
        </button>
      </div>
    </form>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-lg font-semibold">{heading}</legend>
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
